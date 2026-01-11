# Fix: Virtual Environment Naming Convention

## Problem Summary

Panpan created a virtual environment **inside** a cloned repository with a conflicting name:
```
/test-spargeattn/           <- cloned repo
└── test-spargeattn/        <- venv inside repo (BAD!)
└── spas_sage_attn/         <- source code (shadows installed package)
```

This causes Python import shadowing - the local source directory is found before the installed package in site-packages.

## Root Cause

1. **No guidance**: Panpan has no rules about venv placement conventions
2. **Ambiguous task**: "in path X, in venv Y" was interpreted as nested structure
3. **No validation**: No check for "is this directory already a Python project?"
4. **Workaround over fix**: When error occurred, panpan worked around it (cd /tmp) instead of fixing structure

---

## Solution Design

### Part 1: System Prompt Guidance (Convention)

Add to panpan's system prompt or CLAUDE.md:

```markdown
## Virtual Environment Conventions

When creating Python virtual environments:

1. **Default name**: Always use `.venv` for venvs inside a project directory
   - This is hidden (won't shadow packages) and is the Python community standard
   - Example: `/project/.venv/`

2. **Never nest venv inside source**: Don't create venv in a directory containing:
   - `setup.py`, `pyproject.toml`, or `setup.cfg`
   - A package directory with `__init__.py`

3. **Separate locations**: If venv must have a custom name:
   - Clone repo to: `/path/project-src/`
   - Create venv at: `/path/project-venv/`

4. **Ask for clarification** when:
   - Task specifies same name for repo path and venv
   - Venv path would be inside an existing Python project
```

### Part 2: Validation in Uv Tool (Guardrail)

Modify `src/tools/package-managers/uv.ts` to add validation:

```typescript
// In uv.ts, add validation before venv creation

async function validateVenvPath(
  venvPath: string,
  projectPath: string,
): Promise<{ valid: boolean; warning?: string }> {
  const targetDir = venvPath || ".venv";
  const fullPath = path.isAbsolute(targetDir)
    ? targetDir
    : path.join(projectPath, targetDir);

  // Check if creating venv inside a Python project
  const pythonProjectFiles = ["setup.py", "pyproject.toml", "setup.cfg"];
  for (const file of pythonProjectFiles) {
    if (await exists(path.join(projectPath, file))) {
      // This is a Python project
      if (targetDir !== ".venv" && !path.isAbsolute(targetDir)) {
        return {
          valid: false,
          warning: `Creating venv '${targetDir}' inside Python project may cause import shadowing. ` +
            `Use '.venv' (default) or an absolute path outside the project.`,
        };
      }
    }
  }

  // Check if venv name matches a source directory
  const venvName = path.basename(fullPath);
  const potentialSourceDir = path.join(projectPath, venvName.replace(/-/g, "_"));
  if (await exists(potentialSourceDir)) {
    const initFile = path.join(potentialSourceDir, "__init__.py");
    if (await exists(initFile)) {
      return {
        valid: false,
        warning: `Venv name '${venvName}' may conflict with source package '${venvName.replace(/-/g, "_")}'. ` +
          `This can cause import shadowing.`,
      };
    }
  }

  return { valid: true };
}
```

### Part 3: System Reminder for Venv Creation

Add a new reminder type in `src/services/system-reminder.ts`:

```typescript
// Add new event type
this.addEventListener("venv:creating", (context) => {
  const { path, projectDir } = context as { path?: string; projectDir?: string };

  // Generate reminder if potential conflict detected
  if (path && projectDir && path !== ".venv") {
    this.state.remindersSent.add("venv_convention");
    // Reminder will be injected
  }
});

// Add new reminder generator
private generateVenvConventionReminder(): ReminderMessage | null {
  const key = "venv_convention";
  if (!this.state.remindersSent.has(key)) return null;

  return this.createReminder(
    "venv_convention",
    "general",
    "high",
    `When creating virtual environments:
- Use '.venv' inside projects (hidden, won't shadow)
- Or create venv OUTSIDE the project directory
- Never use a name that matches source directories
- If task specifies conflicting names, ASK for clarification first`
  );
}
```

### Part 4: Ask for Clarification Pattern

When panpan detects a potential naming conflict, it should ask:

```
The task asks for:
- Repository at: /path/test-spargeattn/
- Virtual environment: test-spargeattn

This would create the venv INSIDE the repo, which causes import issues.

Options:
1. Use `.venv` inside the project (recommended): /path/test-spargeattn/.venv/
2. Create venv outside: /path/test-spargeattn-venv/
3. Clone repo with different name: /path/test-spargeattn-src/

Which approach do you prefer?
```

---

## Implementation Order

1. **Immediate**: Add convention guidance to system prompt/CLAUDE.md
2. **Short-term**: Add validation logic to UvTool venv operation
3. **Medium-term**: Add system reminder for venv creation events
4. **Long-term**: Consider a dedicated VenvTool that enforces conventions

---

## Files to Modify

| File | Change |
|------|--------|
| `CLAUDE.md` or system prompt | Add venv convention section |
| `src/tools/package-managers/uv.ts` | Add validateVenvPath() before venv creation |
| `src/services/system-reminder.ts` | Add venv:creating event and reminder |
| `src/tools/bash.ts` | Detect `python -m venv` commands and warn |

---

## Validation Test Cases

After implementing, these should be caught:

1. `cd /project && python -m venv project` - WARN (venv inside project with matching name)
2. `cd /project && uv venv myenv` - WARN (non-.venv inside project)
3. `cd /project && uv venv .venv` - OK (standard convention)
4. `uv venv /separate/path/myenv` - OK (absolute path outside)

---

## Metrics for Success

- No more "ModuleNotFoundError" caused by import shadowing after venv setup
- Panpan asks for clarification when repo/venv names conflict
- All new venvs use `.venv` or are clearly outside project directories
