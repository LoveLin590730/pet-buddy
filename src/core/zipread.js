/* ============================================================================
 * pet-buddy · 共享核心（core）· ZIP 包读取（v4.2：上传 zip 模型包，自动挑出里面的图片）
 * ----------------------------------------------------------------------------
 * 场景：用户从网上下载的桌宠模型常是 zip（源码仓 zip、素材打包 zip），里面混着代码与图片。
 *      模型管理里直接选 zip → 这里解析出图片条目清单 → 用户挑一张 → 解压成 dataUrl，
 *      之后走与「上传图片」完全相同的路径（动画判定 / 2MB·4MB 上限 / localStorage 容量预检）。
 * 实现：纯手工解析 ZIP 结构（EOCD → central directory → local file header），
 *      解压用浏览器/Node 内置的 DecompressionStream('deflate-raw')——零第三方依赖、纯离线。
 * 限制：不支持 zip64（>4GB 或 >65535 条目）与加密包；rar/7z 不在浏览器能力范围内（先转 zip）。
 * 约束：只写顶层 const / function；不 import / 不 export；await 只在 async 函数里。
 * ==========================================================================*/

  /* ---- 二进制读取小工具（ZIP 头都是小端） ---- */
  function zipU16(v, p) { return v[p] | (v[p + 1] << 8); }
  function zipU32(v, p) { return (v[p] | (v[p + 1] << 8) | (v[p + 2] << 16) | (v[p + 3] << 24)) >>> 0; }

  /** 从 ArrayBuffer 解析条目清单：[{name, size, csize, method, offset}]（只读目录，不解压数据） */
  function zipEntries(buf) {
    const v = new Uint8Array(buf);
    const n = v.length;
    if (n < 22 || zipU32(v, 0) !== 0x04034b50) throw new Error('这不是 zip 包（缺 PK 头）');
    /* 1) 从尾部往前找 EOCD（0x06054b50；后面可能跟着最多 64KB 的注释） */
    let eocd = -1;
    for (let i = n - 22; i >= Math.max(0, n - 22 - 65536); i--) {
      if (v[i] === 0x50 && v[i + 1] === 0x4b && zipU16(v, i + 2) === 0x0605) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip 目录读不到（EOCD 未找到）');
    const count = zipU16(v, eocd + 10);
    let cdSize = zipU32(v, eocd + 12), cdOff = zipU32(v, eocd + 16);
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF)
      throw new Error('zip64 包暂不支持：请先解压出来，再挑里面的图上传');
    /* 2) 逐条读 central directory（签名 0x02014b50，固定头 46 字节 + 名 + extra + 注释） */
    const decoder = new TextDecoder();
    const out = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > n || zipU32(v, p) !== 0x02014b50) throw new Error('zip 目录损坏（第 ' + (i + 1) + ' 条对不上）');
      const method = zipU16(v, p + 10);
      const csize = zipU32(v, p + 20);
      const size = zipU32(v, p + 24);
      const nameLen = zipU16(v, p + 28);
      const extraLen = zipU16(v, p + 30);
      const commentLen = zipU16(v, p + 32);
      const offset = zipU32(v, p + 42);
      const name = decoder.decode(v.subarray(p + 46, p + 46 + nameLen));
      if (method === 99) throw new Error('这个 zip 加密了（AES），解不开：请用不加密的 zip');
      if ((zipU16(v, p + 8) & 0x1) === 0) out.push({ name: name, size: size, csize: csize, method: method, offset: offset });
      /* 带加密 flag（bit0）的条目直接跳过，不让它出现在可选列表里 */
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /** 条目是不是能当皮肤的图片（png/gif/webp/jpg；排除 macOS 垃圾目录与隐藏文件） */
  function zipImageEntries(entries, maxSize) {
    const lim = maxSize || 8 * 1024 * 1024;
    return (entries || []).filter(function (e) {
      if (!e || !e.name || e.size > lim || e.size < 64) return false;
      const low = e.name.toLowerCase();
      if (low.indexOf('__macosx/') >= 0 || low.split('/').pop().charAt(0) === '.') return false;
      return /\.(png|gif|webp|jpe?g|apng)$/.test(low);
    });
  }

  /** raw deflate 解压（内置 DecompressionStream；不支持时给人话错误） */
  async function zipInflateRaw(u8) {
    if (typeof DecompressionStream !== 'function')
      throw new Error('当前内核不支持解压 zip（需要较新的 Edge/Chrome）');
    const ds = new DecompressionStream('deflate-raw');
    const wr = ds.writable.getWriter();
    const pump = wr.write(u8).then(function () { return wr.close(); }).catch(function () { /* 读端报错即可 */ });
    const rd = ds.readable.getReader();
    const chunks = [];
    for (;;) {
      const r = await rd.read();
      if (r.done) break;
      chunks.push(r.value);
    }
    await pump.catch(function () { /* 解压失败在下面统一报 */ });
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }

  /** 解压单个条目 → Uint8Array（stored 直取；deflate 走 DecompressionStream） */
  async function zipExtract(buf, entry) {
    const v = new Uint8Array(buf);
    const p = entry.offset;
    if (zipU32(v, p) !== 0x04034b50) throw new Error('条目定位失败（包可能不完整）');
    const nameLen = zipU16(v, p + 26);
    const extraLen = zipU16(v, p + 28);
    const start = p + 30 + nameLen + extraLen;
    const data = v.subarray(start, start + entry.csize);
    if (entry.method === 0) return data;                    // stored：原样
    if (entry.method === 8) return await zipInflateRaw(data); // deflate
    throw new Error('不支持的压缩方法（' + entry.method + '）');
  }

  /** Uint8Array → dataUrl（按扩展名给 MIME；base64 手工编，不依赖 FileReader） */
  function zipBytesToDataUrl(bytes, name) {
    const low = String(name || '').toLowerCase();
    const mime = /\.gif$/.test(low) ? 'image/gif' : /\.webp$/.test(low) ? 'image/webp'
      : /\.jpe?g$/.test(low) ? 'image/jpeg' : 'image/png';
    let s = '';
    const CH = 32768;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return 'data:' + mime + ';base64,' + btoa(s);
  }
