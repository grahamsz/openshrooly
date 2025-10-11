# Contributing to OpenShrooly

Thanks for helping improve the project! This document covers the core tooling we recommend so contributors share a consistent experience across platforms.

## Prerequisites

- **Python 3.11+** – required for ESPHome tooling.
- **Node.js 20+** – required for building the web dashboard.
- **direnv** (optional, but recommended) – auto-loads local development environments.

Install the languages with your preferred package manager (e.g. `brew`, `asdf`, `pyenv`, `nvm`).

## Recommended initial setup

1. **Enable direnv (optional)**
   - Install direnv: `brew install direnv` (macOS) or follow <https://direnv.net/>.
   - Hook it into your shell, for example:
     ```sh
     echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
     ```
   - From the project root:
     ```sh
     direnv allow
     ```
     The provided `.envrc` creates project-scoped Python and Node environments (via direnv’s `layout` helpers) and prepends local `node_modules/.bin` directories to `PATH`. If you need custom secrets or overrides, place them in `.envrc.local`—it’s automatically sourced when present and stays outside version control.

2. **Install JavaScript dependencies**
   ```sh
   cd webapp
   npm install
   ```

3. **Install Python tooling**
   ```sh
   python3 -m pip install --upgrade pip
   pip install esphome
   ```

## Working with git hooks

We prefer plain git hooks in this repository. If you add project-level hooks (for automatic formatters, etc.), commit them under `.githooks/` and document any required tooling here so contributors can opt in with:

```sh
git config core.hooksPath .githooks
```

Hooks should strive to auto-fix where possible and avoid blocking commits outright; CI workflows will provide the final enforcement.

## Running key tasks

- **Build the web dashboard**:
  ```sh
  cd webapp
  npm run build
  ```
- **Validate ESPHome configuration**:
  ```sh
  esphome config esphome/openshrooly.yaml
  ```
- **Compile firmware**:
  ```sh
  esphome compile esphome/openshrooly.yaml
  ```

Refer to the CI workflow (`.github/workflows/ci.yml`) for the full command sequence executed on pull requests.
