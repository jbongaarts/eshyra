#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { readHandoff, resolveSeatRoots, SEATS } from './seatContext.mjs';

const VALID_SEATS = new Set(Object.values(SEATS));
const usage =
  'Usage: node scripts/seats/seat-handoff.mjs <path|show|write|clear> <claude-captain|codex-captain>';

function failUsage() {
  process.stderr.write(`${usage}\n`);
  process.exitCode = 2;
}

const [command, seatId] = process.argv.slice(2);
if (
  !['path', 'show', 'write', 'clear'].includes(command) ||
  !VALID_SEATS.has(seatId)
) {
  failUsage();
} else {
  const roots = resolveSeatRoots(process.cwd(), process.env);
  if (roots === null) {
    process.stderr.write('Unable to resolve the repository state directory.\n');
    process.exitCode = 1;
  } else {
    const handoffPath = resolve(roots.stateDir, seatId, 'handoff.md');
    if (command === 'path') {
      process.stdout.write(`${handoffPath}\n`);
    } else if (command === 'show') {
      const handoff = readHandoff(seatId, process.cwd(), process.env);
      if (handoff === null) {
        process.stdout.write(`No handoff recorded for ${seatId}.\n`);
      } else {
        process.stdout.write(
          `${handoff.text}\nRecorded ${handoff.ageHours}h ago at ${handoff.path}.\n`,
        );
      }
    } else if (command === 'write') {
      let text;
      try {
        text = readFileSync(0, 'utf8');
      } catch {
        process.stderr.write('Unable to read handoff from stdin.\n');
        process.exitCode = 2;
      }
      if (text !== undefined) {
        if (text.trim() === '') {
          process.stderr.write('Handoff text must not be empty.\n');
          process.exitCode = 2;
        } else {
          mkdirSync(resolve(roots.stateDir, seatId), { recursive: true });
          writeFileSync(
            handoffPath,
            `<!-- recorded ${new Date().toISOString()} -->\n${text}`,
          );
          process.stdout.write(`${handoffPath}\n`);
        }
      }
    } else if (existsSync(handoffPath)) {
      try {
        if (!statSync(handoffPath).isFile()) throw new Error('not a file');
        rmSync(handoffPath);
        process.stdout.write(`${handoffPath}\n`);
      } catch {
        process.stderr.write(`Unable to clear ${handoffPath}.\n`);
        process.exitCode = 1;
      }
    }
  }
}
