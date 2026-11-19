/* ============================================================================
 * pet-buddy · 共享核心（core）· ZIP 打包（v4.8：表情包批量导出）
 * ----------------------------------------------------------------------------
 * 读 zip 在 zipread.js（上传模型包用），这里负责**写** zip（导出表情包用）。
 * 只用 store（不压缩）——够用、零依赖、且浏览器不需要压缩库；配合 zipread.js
 * 解压逻辑互不干扰（解压时 method=0 直接取字节）。
 * 结构按 ZIP 规范：local file header（0x04034b50）+ 数据 + central directory（0x02014b50）+ EOCD（0x06054b50）。
 * 文件名用 UTF-8 并置 flag 0x0800（语言编码标志），中文文件名不会乱码。
 * 约束：只写顶层 const / function；不 import / 不 export；不碰 DOM（返回 Uint8Array，调用方自己造 Blob）。
 * ==========================================================================*/

  /** CRC32（ZIP 校验和）；表按需构建一次并缓存 */
  let zipCrcTable = null;
  function zipCrc32(u8) {
    if (!zipCrcTable) {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
      zipCrcTable = t;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) crc = zipCrcTable[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /** DOS 时间/日期（zip 头部要合法值，否则某些解压软件会抱怨） */
  function zipDosStamp(d) {
    const dt = d instanceof Date ? d : new Date();
    const y = Math.max(1980, dt.getFullYear());
    return {
      time: ((dt.getHours() & 31) << 11) | ((dt.getMinutes() & 63) << 5) | ((dt.getSeconds() / 2) & 31),
      date: (((y - 1980) & 127) << 9) | (((dt.getMonth() + 1) & 15) << 5) | (dt.getDate() & 31),
    };
  }

  /** 打一个 zip（store 不压缩）。files = [{name, data:Uint8Array}] → Uint8Array。
   *  调用方拿它造 Blob({type:'application/zip'}) 再触发下载。 */
  function zipBuild(files) {
    const enc = new TextEncoder();
    const list = (files || []).filter(f => f && f.name && f.data);
    const stamp = zipDosStamp(new Date());
    const locals = [], centrals = [];
    let offset = 0;
    for (const f of list) {
      const nameB = enc.encode(String(f.name));
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const crc = zipCrc32(data);
      const lh = new Uint8Array(30 + nameB.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(6, 0x0800, true);        // flag: 文件名 UTF-8
      lv.setUint16(8, 0, true);             // method: store
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);  // compressed size
      lv.setUint32(22, data.length, true);  // uncompressed size
      lv.setUint16(26, nameB.length, true);
      lh.set(nameB, 30);
      locals.push(lh, data);
      centrals.push({ nameB: nameB, crc: crc, size: data.length, offset: offset });
      offset += lh.length + data.length;
    }
    const cdParts = [];
    let cdLen = 0;
    for (const c of centrals) {
      const ch = new Uint8Array(46 + c.nameB.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);            // version made by
      cv.setUint16(6, 20, true);            // version needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, c.crc, true);
      cv.setUint32(20, c.size, true);
      cv.setUint32(24, c.size, true);
      cv.setUint16(28, c.nameB.length, true);
      cv.setUint32(42, c.offset, true);
      ch.set(c.nameB, 46);
      cdParts.push(ch);
      cdLen += ch.length;
    }
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, centrals.length, true);
    ev.setUint16(10, centrals.length, true);
    ev.setUint32(12, cdLen, true);
    ev.setUint32(16, offset, true);
    let total = offset + cdLen + 22;
    const out = new Uint8Array(total);
    let p = 0;
    for (const part of locals) { out.set(part, p); p += part.length; }
    for (const part of cdParts) { out.set(part, p); p += part.length; }
    out.set(eocd, p);
    return out;
  }
