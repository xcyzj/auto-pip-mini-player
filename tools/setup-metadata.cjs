#!/usr/bin/env node
/**
 * 发布前把脚本/文档里的占位符一次性替换成你自己的信息。
 *
 * 用法（在仓库根目录执行）：
 *   node tools/setup-metadata.cjs --name "你的展示名" --github 你的GitHub用户名
 *   node tools/setup-metadata.cjs --name "张三" --github zhangsan --repo my-userscript
 *   node tools/setup-metadata.cjs --name "张三" --github zhangsan --gf-user 123456 --gf-script 789012
 *   node tools/setup-metadata.cjs --dry          # 只看会改什么，不写文件
 *
 * 会改的地方：
 *   仓库根目录下的 *.user.js       @author / @namespace / @homepageURL / @supportURL / @downloadURL / @updateURL
 *   README.md                      仓库链接
 *   LICENSE                        版权行（年份自动取当年）
 *   package.json                   name
 *
 * 可以反复执行：每次都直接覆盖这几处，不会重复添加。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 脚本文件名不写死：仓库根目录下唯一的 *.user.js 就是它（改名后无需改这里）
function findScriptFile() {
  const found = fs.readdirSync(ROOT).filter((f) => f.endsWith('.user.js'));
  if (found.length !== 1) {
    console.error('在 ' + ROOT + ' 里找到 ' + found.length + ' 个 *.user.js，期望恰好 1 个：' + found.join(', '));
    process.exit(1);
  }
  return path.join(ROOT, found[0]);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') {
      out.dry = true;
      continue;
    }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = m[2] !== undefined ? m[2] : argv[++i];
    out[key] = val;
  }
  return out;
}

const args = parseArgs(process.argv);
const name = args.name;
const github = args.github;
const repo = args.repo || 'auto-pip-mini-player';
const gfUser = args.gfUser;
const gfScript = args.gfScript;
const dry = !!args.dry;

if (!name || !github) {
  console.error('缺少参数。示例：');
  console.error('  node tools/setup-metadata.cjs --name "张三" --github zhangsan');
  console.error('可选：--repo <仓库名>（默认 auto-pip-mini-player）、--gf-user <GreasyFork用户ID>、--gf-script <GreasyFork脚本ID>、--dry');
  process.exit(1);
}
if (!/^[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error('仓库名只允许字母、数字、点、下划线、连字符：' + repo);
  process.exit(1);
}

const repoUrl = 'https://github.com/' + github + '/' + repo;
const namespace = gfUser ? 'https://greasyfork.org/users/' + gfUser : repoUrl;
const scriptFile = findScriptFile();
const readmeFile = path.join(ROOT, 'README.md');
const licenseFile = path.join(ROOT, 'LICENSE');
const pkgFile = path.join(ROOT, 'package.json');

const changes = [];

function setMetadataLine(text, key, value, file) {
  const re = new RegExp('^(// @' + key + '\\s+).*$', 'm');
  if (!re.test(text)) {
    // 没有这一行就插到元数据块末尾（例如发布到 GreasyFork 后才补的 @downloadURL / @updateURL）
    const end = text.indexOf('// ==/UserScript==');
    if (end < 0) {
      changes.push('  ! ' + path.basename(file) + ' 里没找到元数据块，跳过 @' + key);
      return text;
    }
    const line = '// @' + key + ' '.repeat(Math.max(1, 14 - key.length)) + value + '\n';
    changes.push('  + @' + key + ' = ' + value + '（新增）');
    return text.slice(0, end) + line + text.slice(end);
  }
  const next = text.replace(re, '$1' + value);
  if (next !== text) changes.push('  · @' + key + ' = ' + value);
  return next;
}

function replaceInFile(file, transform, label) {
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) {
    changes.push('  = ' + label + '（无需改动）');
    return;
  }
  changes.push('  · ' + label);
  if (!dry) fs.writeFileSync(file, after, 'utf8');
}

/* ---------- 1. 脚本头部 ---------- */
{
  const before = fs.readFileSync(scriptFile, 'utf8');
  let t = before;
  const title = path.basename(scriptFile);
  t = setMetadataLine(t, 'author', name, scriptFile);
  t = setMetadataLine(t, 'namespace', namespace, scriptFile);
  t = setMetadataLine(t, 'homepageURL', repoUrl, scriptFile);
  t = setMetadataLine(t, 'supportURL', repoUrl + '/issues', scriptFile);
  if (gfScript) {
    const u = 'https://update.greasyfork.org/scripts/' + gfScript + '/' + path.basename(scriptFile);
    t = setMetadataLine(t, 'downloadURL', u, scriptFile);
    t = setMetadataLine(t, 'updateURL', u, scriptFile);
  } else {
    changes.push('  i 未提供 --gf-script，@downloadURL / @updateURL 保持原样（通常不用填：装 GreasyFork 的副本会由 GreasyFork 负责更新）');
  }
  if (t !== before) {
    changes.push('  <' + title + '>');
    if (!dry) fs.writeFileSync(scriptFile, t, 'utf8');
  }
}

/* ---------- 2. README 里的仓库链接 ---------- */
replaceInFile(
  readmeFile,
  (t) => t.replace(/https:\/\/github\.com\/[^/\s>)]+\/[^/\s>)]+/g, repoUrl),
  'README.md：仓库链接 → ' + repoUrl
);

/* ---------- 3. LICENSE 版权行 ---------- */
replaceInFile(
  licenseFile,
  (t) => t.replace(/^Copyright \(c\) \d{4} .*$/m, 'Copyright (c) ' + new Date().getFullYear() + ' ' + name),
  'LICENSE：Copyright (c) ' + new Date().getFullYear() + ' ' + name
);

/* ---------- 4. package.json 的 name ---------- */
replaceInFile(pkgFile, (t) => t.replace(/^(\s*"name":\s*)"[^"]*"/m, '$1"' + repo + '"'), 'package.json：name = ' + repo);

console.log((dry ? '[预览，未写入]\n' : '[已写入]\n') + changes.join('\n'));
if (!dry) {
  console.log('\n下一步：确认无误后提交到仓库。改完可以用 npm test 确认脚本没被改坏。');
}

