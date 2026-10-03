# MySQL Mock Data

DBX workbench plugin that reads the selected MySQL table's column metadata, generates previewable `INSERT` SQL, and exposes a SQL-generation tool through DBX MCP. The plugin itself does not execute generated statements.

## Features

- Open from a connection's context menu to choose a database and table in the workbench, or open directly from a table's context menu.
- Read MySQL column types, nullability, defaults, generated columns, and length metadata through DBX's read-only query API.
- Search and choose a database and table in the workbench after opening it from a connection; opening from a table preselects that table.
- Generate up to 500 rows of SQL, with type-aware values, field-name rules, and sampling from existing rows.
- Copy the SQL or save it as a `.sql` file.
- Choose a bundled generator or select an external CLI to see its install steps and a command based on the selected MySQL database and table. External CLIs are never launched by the plugin.
- Expose `generate_mock_insert_sql` through DBX MCP. It returns SQL only; use DBX's own `dbx_execute_query` tool to apply the INSERT so DBX's MCP write policy remains in force.

Auto-increment and generated columns are omitted because MySQL supplies or computes those values. All other writable columns are generated, including columns with defaults. Review unique constraints and foreign keys before running generated SQL. Data is synthetic and intended for development use.

## Develop

```bash
npm install
npm test
npm run build
dbx-plugin dev --path . --port 5190
```

Build a review package for the current platform with:

```bash
dbx-plugin package .
```

The package command builds the Rust Sidecar for the current platform.

`npm test` runs the Sidecar's Rust unit tests using the SDK bundled with the global `@dbx-app/plugin-cli` installation. The `ui/` directory contains generated Vite assets and is ignored; run `npm run build` before packaging. The release workflow builds target-specific packages for Linux, macOS, and Windows.

Enable the tools from Plugin Center → Installed → Built-in AI tools. For the external DBX MCP server, enable plugin tools and allowlist the full exposed tool name shown in DBX Settings → MCP. The tool only returns SQL; apply it with DBX's `dbx_execute_query` tool, which remains subject to DBX's configured write policy.
