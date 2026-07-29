/**
 * Injectable GitHub boundary.
 *
 * Every network access the review system performs goes through
 * `ReviewGitHubClient`. Unit tests inject an in-memory implementation and
 * never touch a live service; the CLI injects the `gh` implementation.
 *
 * The interface is deliberately tiny — read a PR, read its comments, create or
 * update one comment. It cannot merge, close, label, or approve anything,
 * because the review system is forbidden from silently mutating PRs.
 */

import { spawnSync } from 'node:child_process';

export interface PullRequestSnapshot {
  readonly number: number;
  readonly title: string;
  readonly state: 'OPEN' | 'CLOSED' | 'MERGED';
  readonly isDraft: boolean;
  readonly headRefName: string;
  readonly headSha: string;
  readonly baseRefName: string;
  /** Repo-relative paths changed against the merge base. */
  readonly changedPaths: readonly string[];
}

export interface IssueComment {
  readonly id: number;
  readonly body: string;
  readonly url: string;
  readonly createdAt: string;
  readonly authorLogin: string;
}

export interface ReviewGitHubClient {
  getPullRequest(number: number): Promise<PullRequestSnapshot>;
  listComments(number: number): Promise<readonly IssueComment[]>;
  createComment(number: number, body: string): Promise<IssueComment>;
  updateComment(commentId: number, body: string): Promise<IssueComment>;
  /** True when `path` exists on the PR's base branch. */
  baseBranchHasPath(baseRefName: string, path: string): Promise<boolean>;
}

export class GitHubAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAccessError';
  }
}

interface GhOptions {
  readonly cwd: string;
  readonly repo?: string;
}

function gh(args: readonly string[], options: GhOptions): string {
  const full = options.repo ? [...args, '--repo', options.repo] : [...args];
  const result = spawnSync('gh', full, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, GH_PAGER: 'cat', GH_PROMPT_DISABLED: '1' },
  });
  if (result.error) {
    throw new GitHubAccessError(
      `Failed to run gh ${full.join(' ')}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new GitHubAccessError(
      `gh ${full.join(' ')} exited ${result.status}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

interface GhPrView {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  files?: { path: string }[];
}

interface GhComment {
  id: number;
  body: string;
  html_url: string;
  created_at: string;
  user?: { login?: string };
}

/** Production client, backed by the `gh` CLI already used across this repo. */
export class GhCliGitHubClient implements ReviewGitHubClient {
  constructor(private readonly options: GhOptions) {}

  async getPullRequest(number: number): Promise<PullRequestSnapshot> {
    const raw = gh(
      [
        'pr',
        'view',
        String(number),
        '--json',
        'number,title,state,isDraft,headRefName,headRefOid,baseRefName,files',
      ],
      this.options,
    );
    const parsed = JSON.parse(raw) as GhPrView;
    const state = parsed.state.toUpperCase();
    if (state !== 'OPEN' && state !== 'CLOSED' && state !== 'MERGED') {
      throw new GitHubAccessError(`Unrecognized PR state: ${parsed.state}`);
    }
    return {
      number: parsed.number,
      title: parsed.title,
      state,
      isDraft: parsed.isDraft,
      headRefName: parsed.headRefName,
      headSha: parsed.headRefOid,
      baseRefName: parsed.baseRefName,
      changedPaths: (parsed.files ?? []).map((file) => file.path),
    };
  }

  async listComments(number: number): Promise<readonly IssueComment[]> {
    const raw = gh(
      ['api', '--paginate', `repos/{owner}/{repo}/issues/${number}/comments`],
      this.options,
    );
    // `--paginate` concatenates JSON arrays; normalize to one array.
    const chunks = raw
      .split(/\n(?=\[)/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk !== '');
    const comments: GhComment[] = chunks.flatMap(
      (chunk) => JSON.parse(chunk) as GhComment[],
    );
    return comments.map((comment) => ({
      id: comment.id,
      body: comment.body ?? '',
      url: comment.html_url,
      createdAt: comment.created_at,
      authorLogin: comment.user?.login ?? '',
    }));
  }

  async createComment(number: number, body: string): Promise<IssueComment> {
    const raw = gh(
      [
        'api',
        '--method',
        'POST',
        `repos/{owner}/{repo}/issues/${number}/comments`,
        '-f',
        `body=${body}`,
      ],
      this.options,
    );
    return toComment(JSON.parse(raw) as GhComment);
  }

  async updateComment(commentId: number, body: string): Promise<IssueComment> {
    const raw = gh(
      [
        'api',
        '--method',
        'PATCH',
        `repos/{owner}/{repo}/issues/comments/${commentId}`,
        '-f',
        `body=${body}`,
      ],
      this.options,
    );
    return toComment(JSON.parse(raw) as GhComment);
  }

  async baseBranchHasPath(baseRefName: string, path: string): Promise<boolean> {
    const result = spawnSync(
      'git',
      ['cat-file', '-e', `origin/${baseRefName}:${path}`],
      { cwd: this.options.cwd, encoding: 'utf8' },
    );
    if (result.error) {
      throw new GitHubAccessError(
        `Failed to inspect base branch ${baseRefName}: ${result.error.message}`,
      );
    }
    return result.status === 0;
  }
}

function toComment(comment: GhComment): IssueComment {
  return {
    id: comment.id,
    body: comment.body ?? '',
    url: comment.html_url,
    createdAt: comment.created_at,
    authorLogin: comment.user?.login ?? '',
  };
}
