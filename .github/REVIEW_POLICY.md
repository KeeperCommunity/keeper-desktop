# Pull request review policy

## Copilot effort

Desktop defaults to **Lite**. Before requesting the first review or marking a draft ready, select the whole PR's effort in GitHub and record its reason in the PR description. A saved PR effort overrides the repository default; verify it when updating an existing PR. [GitHub controls the review model](https://docs.github.com/en/copilot/concepts/agents/code-review); the model selected in ChatGPT or Codex does not select Copilot's model.

- **Lite:** routine UI, styling, noncritical copy, documentation, or isolated changes with understood, low risk.
- **Balanced:** keys, signing, recovery, backup, authentication, pairing, transactions, wallet migration, security-sensitive copy or dependencies, permissions, complex changes, changes spanning services/repositories, or unclear risk.

Use Balanced when a PR mixes categories or its risk is uncertain. This policy and the PR template document the choice; they do not configure GitHub effort or enforce a CI gate.

## Review timing and evidence

Keep automatic first review for ready PRs active. Keep automatic reviews of drafts and every push disabled. Finish relevant checks and batch fixes before requesting another review for material source changes. Routine documentation edits do not need another paid review.

If a material security PR was automatically reviewed at Lite, select Balanced and request one substantive final review after batching fixes and stabilizing checks. A Lite review does not count as Balanced.

Record the actual effort reported by Copilot, the reviewed commit SHA, the review link, and how feedback was addressed. A review of an older commit is evidence only for that commit; explain material changes since that review and request another review when needed. If quota or availability prevents a review, record that status explicitly. Quota unavailability is not a completed review, and a missing effort/head must remain unverified.

## Optional human review and merge

Human developer review is optional. **Ben (`ben-kaufman`)**, **Utkarsh (`cakesoft-utkarsh`)**, and **Parsh (`Parsh`)** are suggested reviewers when useful and already eligible. Pending invitations or the absence of human review do not block readiness or merge and do not require an access grant. CODEOWNERS contains suggestions only; no human approval is required.

All required checks and resolution of relevant review concerns remain required. Record any requested human review, findings and their disposition accurately, and confirm review evidence applies to the current changes. Product signoff, required security and native validation, and operation-specific signing, deployment and release authorization remain separate. Repository branch protection remains the merge enforcement mechanism.
