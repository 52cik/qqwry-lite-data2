const fs = require('fs');
const zlib = require('zlib');
const { join } = require('path');
const { Transform } = require('stream');
const ora = require('ora');
const got = require('got');
const GBK = require('gbk.js');
const { QQwry } = require('qqwry-lite');

const spinner = ora();

const headers = {
  'user-agent': 'Mozilla/3.0 (compatible; Indy Library)',
};

const host = 'http://update.cz88.net';
const urls = {
  copywrite: `${host}/ip/copywrite.rar`,
  qqwry: `${host}/ip/qqwry.rar`,
};

const datPath = join(__dirname, 'qqwry.dat');

/**
 * 读取线上最新版本信息
 */
async function getLastInfo() {
  const { body } = await got(urls.copywrite, {
    headers,
    encoding: null,
  });
  const key = body.readUIntLE(0x14, 4);
  const version = GBK.decode(body.slice(0x18, 0x18 + 0x80)).replace(/\0/g, '');
  return { key, version };
}

/**
 * 检测是否最新版本
 * @param {object} lastInfo 线上版本信息
 */
function isLatest(lastInfo) {
  const dataVersion = new QQwry(datPath).searchIP('255.255.255.255').info;
  const lastVersion = lastInfo.version.split(' ')[1];
  return dataVersion.includes(lastVersion);
}

// 解码算法
class QqwryDecode extends Transform {
  constructor(key, options) {
    super(options);
    this.key = key;
    this.writeN = 0x200;
  }

  _transform(chunk, encoding, callback) {
    if (this.writeN <= 0) {
      return callback(null, chunk);
    }

    const max = this.writeN > chunk.length ? chunk.length : this.writeN;
    let { key } = this;
    this.writeN -= max;

    for (let i = 0; i < max; i += 1) {
      key *= 0x805;
      key += 1;
      key &= 0xff;
      chunk[i] ^= key;
    }
    this.key = key;
    return callback(null, chunk);
  }

  _flush(cb) {
    cb();
  }
}

// 更新数据
function update(lastInfo) {
  const tmpPath = `${datPath}.tmp`;
  spinner.start('开始更新。');
  return new Promise((resolve, reject) => {
    got
      .stream(urls.qqwry, { headers })
      .on('downloadProgress', progress => {
        spinner.start(`更新进度: ${(progress.percent * 100).toFixed(2)}%`);
      })
      .on('error', reject)
      .pipe(new QqwryDecode(lastInfo.key)) // 解码
      .on('error', reject)
      .pipe(zlib.createInflate()) // 解压
      .on('error', reject)
      .pipe(fs.createWriteStream(tmpPath))
      .on('error', reject)
      .on('finish', () => {
        fs.renameSync(tmpPath, datPath);
        resolve();
      });
  });
}

(async () => {
  const lastInfo = await getLastInfo();
  const latest = await isLatest(lastInfo);
  if (latest) {
    spinner.succeed(`已是最新版本 - ${lastInfo.version}`);
    return;
  }
  await update(lastInfo);
  spinner.succeed(`已更新到最新版本 - ${lastInfo.version}`);
})().catch((err) => {
  spinner.fail(`更新失败: ${err.message}`);
});
