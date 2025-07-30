# donkeyops

> A GitHub App built with [Probot](https://github.com/probot/probot) framework for managing PRs and Issues with conventional commits, automatic labeling, and slash commands

[![Test](https://github.com/rucio/donkeyops/actions/workflows/test.yml/badge.svg)](https://github.com/rucio/donkeyops/actions/workflows/test.yml)
[![Lint](https://github.com/rucio/donkeyops/actions/workflows/lint.yml/badge.svg)](https://github.com/rucio/donkeyops/actions/workflows/lint.yml)

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t donkeyops .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> donkeyops
```

## Contributing

If you have suggestions for how donkeyops could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2025 Rucio
