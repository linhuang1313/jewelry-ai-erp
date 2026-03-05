---
name: jewelry-deployment
description: Use when completing code changes - provides project deployment config and auto-push workflow for GitHub and Railway
---

# Jewelry ERP Deployment Configuration

This skill provides deployment configuration and workflow for the Jewelry ERP project. Use this after completing any code changes to automatically push to GitHub and deploy to Railway.

## Project Configuration

### GitHub Repository
- **Repository URL**: `https://github.com/linhuang1212-coder/jewelry-ai-erp`
- **Default Branch**: `main`
- **Local Path**: `C:\Users\hlin2\jewelry-ai-erp`

### Railway Deployment
- **Project URL**: `https://railway.com/project/6cc3e2f2-b8ea-467a-bb82-4bab4922a498?environmentId=de6ce7ab-d736-4f8d-9551-1b8b75f3d87b`
- **Deployment Mode**: Auto-deploy on GitHub push
- **Note**: Railway automatically detects pushes to main branch and triggers deployment

## Mandatory Workflow

**IMPORTANT**: After completing ANY code fix, feature, or modification, you MUST automatically execute the following workflow:

### Step 1: Check Git Status
```powershell
cd C:\Users\hlin2\jewelry-ai-erp; git status
```

### Step 2: Stage Changes
```powershell
cd C:\Users\hlin2\jewelry-ai-erp; git add <modified-files>
```
Or to add all changes:
```powershell
cd C:\Users\hlin2\jewelry-ai-erp; git add -A
```

### Step 3: Commit Changes
**Use English commit messages** (to avoid PowerShell encoding issues with Chinese characters):
```powershell
cd C:\Users\hlin2\jewelry-ai-erp; git commit -m "Brief description of changes"
```

### Step 4: Push to GitHub
```powershell
cd C:\Users\hlin2\jewelry-ai-erp; git push origin main
```

### Step 5: Confirm Success
After successful push, inform the user:
- Commit hash
- Push confirmation
- Railway will auto-deploy (user can check status at Railway dashboard)

## Commit Message Guidelines

Use concise English commit messages following this format:
- `Fix: <description>` - for bug fixes
- `Add: <description>` - for new features
- `Update: <description>` - for modifications
- `Refactor: <description>` - for code refactoring
- `Style: <description>` - for UI/styling changes

Examples:
- `Fix: print function now opens new window with statement content only`
- `Add: customer reconciliation statement generation`
- `Update: gold receipt system to use new unified model`

## PowerShell Compatibility

**Important**: Use semicolons (`;`) instead of `&&` to chain commands in PowerShell:
```powershell
# Correct
cd C:\Users\hlin2\jewelry-ai-erp; git status

# Incorrect (will fail in PowerShell)
cd C:\Users\hlin2\jewelry-ai-erp && git status
```

## Error Handling

### Push Rejected
If push is rejected due to remote changes:
```powershell
cd C:\Users\hlin2\jewelry-ai-erp; git pull --rebase origin main
cd C:\Users\hlin2\jewelry-ai-erp; git push origin main
```

### Commit Message Encoding Error
If commit fails with encoding error, ensure the message is in English only.

### Authentication Error
If authentication fails, user may need to re-authenticate with GitHub credentials.

## Quick Reference

| Action | Command |
|--------|---------|
| Check status | `git status` |
| Stage all | `git add -A` |
| Commit | `git commit -m "message"` |
| Push | `git push origin main` |
| Pull | `git pull origin main` |

## Automation Rule

**Every agent session must follow this rule:**
> After completing any code change (fix, feature, or modification), automatically execute the git workflow to push changes to GitHub. Do not wait for user to ask - proactively commit and push after work is complete.
