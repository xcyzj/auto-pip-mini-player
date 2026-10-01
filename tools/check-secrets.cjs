#!/usr/bin/env node
/**
 * 敏感信息扫描 —— 推送前 / CI 里检查有没有把密钥、令牌、凭据提交进仓库。
 *
 * 用法：
 *   node tools/check-secrets.cjs               # 扫描所有被 git 跟踪的文件（CI 用）
 *   node tools/check-secrets.cjs --staged      # 只扫描已暂存的内容（提交前用）
 *   node tools/check-secrets.cjs --file <路径>  # 只扫某个文件
 *   node tools/check-secrets.cjs --history      # 扫历史提交（慢，偶尔手动跑一次）
 *   node tools/check-secrets.cjs --strict       # 连"疑似"级也当失败
 *
 * 退出码 1 表示发现问题，可直接用于 CI 与 git hook。
 *
 * 分级：
 *   【确定】精确匹配各家令牌格式（GitHub / OpenAI / AWS / Google / Slack / 私钥等）→ 默认失败
 *   【疑似】`api_key = "...."`、JWT 之类启发式匹配 → 默认只提示，加 --strict 才失败
 * 误报处理：在该行加 `check-secrets:allow` 注释，或把正则写进 .secretsignore
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};

/* ---------- 规则 ---------- */

const CONFIRMED = [
  ['GitHub 令牌', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ['GitHub 细粒度令牌', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['OpenAI 密钥', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['Anthropic 密钥', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['AWS Access Key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API 密钥', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack 令牌', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['私钥文件内容', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['npm 令牌', /\bnpm_[A-Za-z0-9]{36}\b/],
];

const SUSPECT = [
  ['疑似硬编码密钥赋值', /(api[_-]?key|apikey|secret|passwd|password|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
  ['疑似 JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf|eot|zip|gz|tgz|7z|rar|pdf|mp4|webm|mp3|wav|xlsx?|docx?|pptx?|exe|dll|so|dylib|wasm)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

function loadIgnore() {
  const f = path.join(ROOT, '.secretsignore');
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      try {
        return new RegExp(l);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}
const IGNORES = loadIgnore();

const mask = (s) => (s.length <= 12 ? s.slice(0, 3) + '***' : s.slice(0, 6) + '***' + s.slice(-4));

function scanText(file, text, out) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes('check-secrets:allow')) return;
    if (IGNORES.some((re) => re.test(line) || re.test(file))) return;
    for (const [name, re] of CONFIRMED) {
      const m = re.exec(line);
      if (m) out.push({ level: '确定', file, line: i + 1, rule: name, sample: mask(m[0]) });
    }
    for (const [name, re] of SUSPECT) {
      const m = re.exec(line);
      if (m) out.push({ level: '疑似', file, line: i + 1, rule: name, sample: mask(m[0]) });
    }
  });
}

/* ---------- 取内容 ---------- */

function gitListFiles() {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error('无法列出 git 跟踪的文件（这个目录是 git 仓库吗？）：' + (r.stderr || '').trim());
    process.exit(2);
  }
  return r.stdout.split('\0').filter(Boolean);
}

function readMaybe(file) {
  const abs = path.join(ROOT, file);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES || BINARY_EXT.test(file)) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return null;
  }
}

function scanTracked(out) {
  const files = gitListFiles();
  let scanned = 0;
  for (const f of files) {
    const text = readMaybe(f);
    if (text == null) continue;
    if (text.includes('\0')) continue; // 二进制
    scanned++;
    scanText(f, text, out);
  }
  return scanned;
}

function scanStaged(out) {
  // 只看"将要提交的内容"：用 --cached 的 diff，逐 hunk 的新增行
  const r = spawnSync('git', ['diff', '--cached', '--unified=0', '--no-color'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return 0;
  let file = '(staged)';
  let lineNo = 0;
  let scanned = 0;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) {
      lineNo = parseInt(hunk[1], 10);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      scanText(file, line.slice(1), { push: (f) => out.push({ ...f, line: lineNo }) });
      scanned++;
      lineNo++;
    }
  }
  return scanned;
}

function scanHistory(out) {
  const revs = spawnSync('git', ['rev-list', '--all'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (revs.status !== 0) return 0;
  const list = revs.stdout.split('\n').filter(Boolean).slice(0, 500);
  let scanned = 0;
  for (const rev of list) {
    const r = spawnSync('git', ['grep', '-I', '-n', '-E', 'ghp_|gho_|ghu_|github_pat_|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|BEGIN [A-Z ]*PRIVATE KEY', rev], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.stdout && r.stdout.trim()) {
      r.stdout.split('\n').filter(Boolean).forEach((l) => {
        const m = /^([^:]+):(\d+):(.*)$/.exec(l);
        out.push({
          level: '确定',
          file: (m ? m[1] : rev) + ' @ ' + rev.slice(0, 7),
          line: m ? m[2] : 0,
          rule: '历史提交里的令牌',
          sample: mask(m ? m[3].trim().slice(0, 80) : l.slice(0, 80)),
        });
      });
    }
    scanned++;
  }
  return scanned;
}

/* ---------- 主流程 ---------- */

const findings = [];
let scanned = 0;

if (has('--file')) {
  const f = valOf('--file');
  const text = readMaybe(f);
  if (text != null) {
    scanText(f, text, findings);
    scanned = 1;
  }
} else if (has('--staged')) {
  scanned = scanStaged(findings);
} else if (has('--history')) {
  scanned = scanHistory(findings);
} else {
  scanned = scanTracked(findings);
}

const errors = findings.filter((f) => f.level === '确定');
const warns = findings.filter((f) => f.level === '疑似');

if (findings.length) {
  console.log('发现 ' + findings.length + ' 处可疑内容：\n');
  findings.forEach((f) => {
    console.log('  [' + f.level + '] ' + f.file + ':' + f.line + '  ' + f.rule + '  →  ' + f.sample);
  });
  console.log('\n处理办法：');
  console.log('  · 真密钥：立刻撤销/轮换（改写历史不等于安全），再从提交里移除');
  console.log('  · 误报：在该行加注释 check-secrets:allow，或写进 .secretsignore');
  console.log('  · 明知风险要硬推：给推送命令加 --skip-secret-check（不推荐）');
}

if (errors.length || (has('--strict') && warns.length)) {
  console.error('\n✗ 检查未通过：' + errors.length + ' 处确定命中，' + warns.length + ' 处疑似。');
  process.exit(1);
}
console.log('✓ 敏感信息扫描通过（检查了 ' + scanned + ' 个' + (has('--history') ? '提交' : has('--staged') ? '处新增行' : '文件') + (warns.length ? '；另有 ' + warns.length + ' 处疑似仅提示' : '') + '）');
