# Graphify Setup

## Installation
Run:
`pip install graphifyy`
`graphify antigravity install`

## Usage
Run script to build graph. It scan frontend, backend, API, DB schema, docs.
Exclude: `node_modules`, `.next`, `dist`, `build`, `coverage`, `logs`.

```bash
npm run graphify
```

## AI Workflow
1. Agent run `npm run graphify` to build index.
2. Agent query graph for codebase map.
3. Fast dev loop. Keep scale for SaaS / Solar EPC.
