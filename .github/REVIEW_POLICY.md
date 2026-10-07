# Pull request review policy

## Copilot effort

The Desktop repository default policy is **Lite**. Before the first review, choose the effort for the whole PR in GitHub and record the choice and reason in the PR description. A saved PR effort overrides the repository default; verify it when updating an existing PR. GitHub controls the review model; the model selected in ChatGPT or Codex does not select Copilot's model.

- **Lite:** routine UI, styling, noncritical copy, documentation, or isolated changes with understood, low risk.
- **Balanced:** keys, signing, recovery, backup, authentication, pairing, transactions, wallet migration, security-sensitive copy or dependencies, permissions, complex changes, changes spanning services/repositories, or unclear risk.

Use Balanced when a PR mixes categories or its risk is uncertain. Set any PR override before the first review. This policy and the PR template document the choice; they do not configure GitHub effort or enforce a CI gate.

## Review timing and evidence

Keep automatic first review for ready PRs active. Keep automatic reviews of drafts and every push disabled. Finish relevant checks and batch fixes before requesting another review for material source changes. Routine documentation edits do not need another paid review.

Record the actual effort reported by Copilot, the reviewed commit SHA, the review link, and how feedback was addressed. A review of an older commit is evidence only for that commit; explain material changes since that review and request another review when needed. If quota or availability prevents a review, record that status explicitly. Quota unavailability is not a completed review, and a missing effort/head must remain unverified.

## Human approval and merge

Merge requires all required checks and one independent human approval from **Ben (`ben-kaufman`)**, **Utkarsh (`cakesoft-utkarsh`)**, or **Parsh (`Parsh`)**. The approver must be someone other than the PR author. CODEOWNERS requests the named reviewers; approval from all three is not required. Copilot feedback does not count as human approval.

Confirm the review evidence and required checks apply to the current changes before merging. Repository branch protection remains the merge enforcement mechanism.
