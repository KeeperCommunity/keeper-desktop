# Keeper Desktop

Keeper Desktop is a a secure, cross-platform desktop app for using hardware wallets with the Bitcoin Keeper mobile app.

## Getting Started

### Prerequisites

- Rust: Make sure you have Rust installed. If not, visit [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install) for installation instructions.
- Node.js and npm: Please ensure you have Node.js and npm installed. You can download them from [https://nodejs.org/](https://nodejs.org/).

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/bithyve/keeper-desktop.git
   cd keeper-desktop
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Run the development build:
   ```
   npm run tauri dev
   ```

### Building for Production

To create a production build:

```
npm run tauri build
```

## Viewing Log Output

To see log output while running the app:

### On Unix-like systems (macOS, Linux):

```bash
RUST_LOG=info npm run tauri dev
```

### On Windows Command Prompt:

```cmd
set RUST_LOG=info && npm run tauri dev
```

### On Windows PowerShell:

```powershell
$env:RUST_LOG="info"; npm run tauri dev
```

You can adjust the log level by changing `info` to `debug`, `warn`, or `error` as needed.

Log messages will appear in the terminal where you run the command.

## Hardware Integration Notes

Keeper Desktop uses a single hardware integration path:

1. **Rust HWI sidecar path** (Trezor / Ledger / BitBox02 / OneKey / etc.)
   - Routed through Tauri commands in `src-tauri/src/main.rs` (`hwi_*` commands).
   - Backed by the `hwi` sidecar binary configured in `src-tauri/tauri.conf.json`.
   - No WebUSB fallback path in the desktop frontend.

### Current OneKey capability scope

- Supported: connect, share xpubs, health check, sign transaction, verify address
- Not supported: register multisig
- Not supported (for now): complex miniscript policy address verification (timelock / nested thresh)

## Code Quality and CI

We use several tools to maintain code quality and consistency:

1. **Linting**:

   - For JavaScript/TypeScript: ESLint
   - For Rust: Clippy
     Run linting checks with:

   ```
   npm run lint        # For JS/TS
   npm run tauri:lint  # For Rust
   ```

2. **Formatting**:

   - For JavaScript/TypeScript: Prettier
   - For Rust: rustfmt
     Check formatting with:

   ```
   npm run format:check       # For JS/TS
   npm run tauri:format:check # For Rust
   ```

   Apply formatting with:

   ```
   npm run format             # For JS/TS
   npm run tauri:format       # For Rust
   ```

3. **Continuous Integration (CI)**:
   We use GitHub Actions for CI. The workflow runs on pull requests to `main`, `dev`, and `release` branches. It includes:

   - JavaScript/TypeScript linting and formatting checks
   - Rust linting and formatting checks

   You can find the CI configuration in `.github/workflows/ci.yml`.

Before submitting a pull request, please ensure that your code passes all linting and formatting checks.

## License

This project is licensed under the **MIT License.**

## Community

- Follow us on [Twitter](https://twitter.com/bitcoinKeeper_)
- Join our [Telegram](https://t.me/bitcoinkeeper)
