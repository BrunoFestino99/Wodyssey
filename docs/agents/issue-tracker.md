# Issue tracker: GitHub

Issues and specs live in BrunoFestino99/Wodyssey on GitHub.
Use GitHub CLI for issue operations.

## CLI

Use `gh` when available on PATH. Otherwise, locate `gh.exe`
recursively under `.git/tools/github-cli/` and invoke that executable.

Before creating issues, verify the target repository with:
`gh repo view --json nameWithOwner`.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,labels`.
- Comment: `gh issue comment <number> --body-file <file>`.
- Labels: `gh issue edit <number> --add-label "..." --remove-label "..."`.
- Close: post an explanation, then run `gh issue close <number>`.

For multiline content, write a temporary UTF-8 file and use
`--body-file`.

Use native GitHub sub-issues and issue dependencies to represent
parent-child relationships and blockers. If unavailable, record
`Part of #<parent>` and `Blocked by: #<number>` in the issue body.
An issue is unblocked when all blockers are closed.

When a skill says to publish to the issue tracker, create a GitHub
issue. When it says to fetch a ticket, read the corresponding issue.

## Pull requests as a triage surface

PRs as a request surface: no.
