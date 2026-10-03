<script>
  import { onMount } from "svelte";
  import { faker as fakerEN } from "@faker-js/faker/locale/en";
  import { faker as fakerZH_CN } from "@faker-js/faker/locale/zh_CN";
  import Chance from "chance";

  let plugin;
  let context;
  let connectionId = "";
  let databaseOptions = [];
  let tableOptions = [];
  let databaseSearch = "";
  let tableSearch = "";
  let databaseOpen = false;
  let tableOpen = false;
  let tableName = "";
  let database = "";
  let columns = [];
  let profiles = {};
  let profileSampleCount = 0;
  let generatorId = "builtin";
  let fakerLocale = "auto";
  let chanceSeed = "";
  let chanceGenerator;
  let rowCount = 20;
  let sql = "";
  let loading = true;
  let generating = false;
  let copied = false;
  let connectionStatus = "unknown";
  let error = "";
  let notice = "";

  const maxRows = 500;
  const generators = [
    { id: "builtin", name: "内置生成器", kind: "builtin", description: "分析字段名、MySQL 类型和最多 100 条现有记录，拟合数据分布、类别与文本格式。", install: "已随插件内置，无需安装。", source: "" },
    { id: "faker", name: "Faker.js", kind: "builtin", description: "已内置；生成中英文姓名、公司、地址、邮箱、网址、手机号、用户名和 UUID。", install: "已随插件内置，无需安装。", source: "https://fakerjs.dev/" },
    { id: "chance", name: "Chance.js", kind: "builtin", description: "已内置；生成姓名、邮箱、电话、地址、公司、网址与随机字符串，支持固定种子复现。", install: "已随插件内置，无需安装。", source: "https://chancejs.com/" },
    { id: "seedforge", name: "SeedForge CLI", kind: "cli", description: "按 MySQL 实际表结构生成，支持 SQL 文件；会自动纳入当前表所需的外键祖先表。", install: "npm install --global @otg-dev/seedforge", source: "https://github.com/Ommanimesh2/seedforge" },
    { id: "spawnflake", name: "Spawnflake CLI", kind: "cli-limited", description: "Rust/MySQL 生成器；支持配置字段规则和全配置行数，但未提供按单表选择或 SQL/CSV 导出参数。", install: "cargo install spawnflake-cli", source: "https://github.com/elasticrash/spawnflake" },
    { id: "seeder", name: "mickamy/seeder", kind: "cli", description: "Go 工具，分析 MySQL schema 并生成数据；支持按 --tables 指定表，也可用 --output sql 导出 INSERT SQL。", install: "brew install mickamy/tap/seeder", source: "https://github.com/mickamy/seeder" },
    { id: "seed-sql", name: "seed-sql", kind: "cli-limited", description: "Gemini AI 生成并直接写入 MySQL；需初始化独立配置，按其交互流程选择表。没有 SQL 导出或文档化行数参数。", install: "npm install --global seed-sql", source: "https://www.npmjs.com/package/seed-sql" },
    { id: "mysql-seed-generator", name: "mysql-seed-generator", kind: "node-api", description: "Node.js API，可按当前表结构及字段映射生成指定条数数据；插件预览区提供可运行脚本。", install: "npm install mysql-seed-generator", source: "https://www.npmjs.com/package/mysql-seed-generator" },
    { id: "go-test-my-db", name: "go-test-my-db", kind: "cli", description: "Go MySQL seeder，支持按 --table 限定当前表、指定行数，并提供 --dry-run 预览。", install: "go install github.com/tomfevang/go-test-my-db@latest", source: "https://github.com/tomfevang/go-test-my-db" },
    { id: "mysql-dummy-populator", name: "mysql-dummy-populator", kind: "cli-limited", description: "Python/Faker 工具；分析外键依赖并按正确顺序为数据库中每张表直接造数。条数按每张表计算，不支持只选当前表。", install: "python -m pip install mysql-dummy-populator", source: "https://github.com/vitebski/mysql-dummy-populator" },
    { id: "dev-toolbox", name: "DevToolbox Database Seed Generator", kind: "web", description: "浏览器端生成 MySQL INSERT、JSON 或 CSV；粘贴建表 DDL 即可使用，不需要安装。", install: "打开在线工具，无需安装。最多生成 1000 行；工具说明数据仅在浏览器本地处理。", source: "https://www.dev-toolbox.tech/tools/database-seed-generator" }
  ];
  $: selectedGenerator = generators.find((item) => item.id === generatorId) ?? generators[0];
  $: generatorCommand = buildGeneratorCommand(selectedGenerator);
  const escId = (value) => `\`${String(value).replaceAll("`", "``")}\``;
  const escText = (value) => String(value).replaceAll("\\", "\\\\").replaceAll("'", "''").replaceAll("\0", "\\0").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
  const rowList = (result) => Array.isArray(result) ? result : result?.rows ?? result?.data ?? [];
  const objectRows = (result) => {
    const rows = rowList(result);
    const resultColumns = result?.columns ?? [];
    return rows.map((row) => {
      if (!Array.isArray(row)) return row;
      return Object.fromEntries(resultColumns.map((column, index) => [column?.name ?? column, row[index]]));
    });
  };
  const valueOf = (row, name) => row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const mysqlEnvironment = () => `# DBX 不会把受保护的连接凭据暴露给外部 CLI；请填入当前连接对应的值\nexport MYSQL_HOST='<HOST>'\nexport MYSQL_PORT='<PORT>'\nexport MYSQL_USER='<USER>'\nexport MYSQL_PASSWORD='<PASSWORD>'\nexport MYSQL_DATABASE=${shellQuote(database)}`;
  const mysqlImportCommand = (filename) => `mysql --host="$MYSQL_HOST" --port="$MYSQL_PORT" --user="$MYSQL_USER" --password --database=${shellQuote(database)} < ${shellQuote(filename)}`;
  function buildGeneratorCommand(generator) {
    if (!generator || !database || !tableName) return "先选择数据库和数据表。";
    const count = Math.max(1, Math.min(maxRows, Math.floor(Number(rowCount) || 1)));
    const filename = `${tableName}.seed.sql`;
    if (generator.kind === "builtin") {
      return `无需安装，点击“生成 INSERT SQL”即可在插件内生成 ${count} 行数据。\n\n# 下载的 SQL 文件名：${tableName}.sql\n${mysqlEnvironment()}\n\n# 执行生成文件（MySQL 会提示输入密码）\n${mysqlImportCommand(`${tableName}.sql`)}`;
    }
    if (generator.id === "seedforge") {
      return `${generator.install}\n\n${mysqlEnvironment()}\n\n# 设置 SeedForge 连接串；把 <URL_ENCODED_PASSWORD> 换成 URL 编码后的密码\nexport DATABASE_URL="mysql://\${MYSQL_USER}:<URL_ENCODED_PASSWORD>@\${MYSQL_HOST}:\${MYSQL_PORT}/${database}"\n\n# 生成当前表及其外键祖先表的 INSERT SQL\nseedforge --db "$DATABASE_URL" --only ${shellQuote(tableName)} --count ${count} --output ${shellQuote(filename)}\n\n# 执行生成文件（MySQL 会提示输入密码）\n${mysqlImportCommand(filename)}`;
    }
    if (generator.id === "seeder") {
      const outputFile = `${tableName}.seed.sql`;
      return `${generator.install}\n# Alternative (Go 1.26+): go install github.com/mickamy/seeder@latest\n\n${mysqlEnvironment()}\n\n# 连接当前数据库，只为所选表生成 SQL（密码需 URL 编码）\nseeder "mysql://\${MYSQL_USER}:<URL_ENCODED_PASSWORD>@\${MYSQL_HOST}:\${MYSQL_PORT}/${database}" --tables ${shellQuote(tableName)} --output sql --rows ${count} > ${shellQuote(outputFile)}\n\n# 确认文件内容后再执行\n${mysqlImportCommand(outputFile)}`;
    }
    if (generator.id === "spawnflake") {
      return `${generator.install}\n\n# spawnflake config.json 需配置 mysql_configuration 与 types 字段规则。\n# -c 指定配置文件，--spawn-size 指定每张配置表的行数；该工具按整个配置运行，不能限定为 DBX 当前所选表。\nspawnflake-cli -c config.json --spawn-size ${count}\n\n# 当前所选表字段，可据此填写 types.string / integer / float：\n${columns.map((column) => `# ${column.name}: ${column.type}`).join("\n")}`;
    }
    if (generator.id === "seed-sql") {
      return `${generator.install}\ncd <你的项目目录>\nseed-sql --init  # 按提示配置 Gemini key 和 MySQL 连接，生成 .seed-sql.config.json\nseed-sql --status\nseed-sql --tables\nseed-sql --generate --prompt ${shellQuote(`仅为 ${database}.${tableName} 生成符合业务语义的测试数据；请生成约 ${count} 条。`)}\n\n# 注意：文档未提供行数参数或 SQL/CSV 导出；--generate 会直接写入配置库，请先确认配置和工具的交互选择。`;
    }
    if (generator.id === "mysql-dummy-populator") {
      return `${generator.install}\n\n${mysqlEnvironment()}\n\n# 可先分析该数据库的表、外键依赖和推荐插入顺序；此命令不写入数据\nmysql-dummy-populator --analyze-only\n\n# 每张表生成 ${count} 条并直接写入数据库 ${database}\nmysql-dummy-populator --records ${count} --locale en_US\n\n# 范围提醒：该工具没有单表筛选参数；它会遍历此数据库的多张表，所选表 ${tableName} 不会限制其写入范围。请确认目标库适合整体造数。`;
    }
    if (generator.id === "go-test-my-db") {
      const dsn = `\${MYSQL_USER}:\${MYSQL_PASSWORD}@tcp(\${MYSQL_HOST}:\${MYSQL_PORT})/${database}`;
      return `${generator.install}\n\n${mysqlEnvironment()}\n\n# 先预览目标表及生成策略\ngo-test-my-db --dsn "${dsn}" --table ${shellQuote(tableName)} --rows ${count} --dry-run\n\n# 确认后移除 --dry-run 执行写入\ngo-test-my-db --dsn "${dsn}" --table ${shellQuote(tableName)} --rows ${count}`;
    }
    if (generator.id === "mysql-seed-generator") {
      const fields = columns.filter((column) => !/auto_increment|generated/i.test(column.extra ?? "")).map((column) => `    ${JSON.stringify(column.name)}: ${JSON.stringify(column.type)}`).join(",\n");
      const mapped = columns.filter((column) => /(?:^|_)(?:created|updated|modified|modify|create|update|modify)_?(?:at|on|time|date|_date|_time)$/i.test(column.name)).map((column) => `    ${JSON.stringify(column.name)}: () => new Date(),`).join("\n");
      return `${generator.install}\n\n${mysqlEnvironment()}\n\n# Node.js 脚本；fields 来自 DBX 当前表结构，自动递增/生成列已排除。\n# map 中的创建/更新时间字段固定为当前时间。\nnode <<'NODE'\nconst seedDatabase = require('mysql-seed-generator');\nseedDatabase({\n  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT),\n  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,\n  database: process.env.MYSQL_DATABASE, table: ${JSON.stringify(tableName)},\n  numRecords: ${count}, batchSize: 500,\n  fields: {\n${fields}\n  },\n  map: {\n${mapped || "    // 可为自定义字段添加 Faker 映射，例如 email_address: 'email'"}\n  }\n}).then(() => console.log('Done')).catch((error) => { console.error(error); process.exitCode = 1; });\nNODE\n\n# 该 API 会直接向指定现有表插入数据；不要开启 dropTableIfExists 或 truncateBeforeInsert。`;
    }
    if (generator.id === "dev-toolbox") {
      return `1. 在 DBX 中查看 ${database}.${tableName} 的建表语句（SHOW CREATE TABLE）。\n2. 打开 DevToolbox 页面：${generator.source}\n3. 粘贴完整 CREATE TABLE 语句，选择 MySQL、SQL INSERT，并设置 ${Math.min(count, 1000)} 行（网页工具上限 1000）。\n4. 生成后复制/下载 INSERT SQL，回到 DBX 检查并执行。\n\n该页面在浏览器本地生成数据，没有可供插件调用的 CLI/API，也不能直接读取 DBX 当前连接。时间字段会生成合理日期范围；若要求 created_at/update_at 均为当前时间，请在执行前检查或调整 SQL。`;
    }
    return `${generator.install}\n\n# 当前表：${database}.${tableName}；行数：${count}`;
  }
  function matchesSearch(value, queryText) {
    const needle = String(queryText).trim().toLocaleLowerCase();
    if (!needle) return true;
    const haystack = String(value).toLocaleLowerCase();
    if (haystack.includes(needle)) return true;
    let position = 0;
    for (const character of haystack) {
      if (character === needle[position]) position += 1;
      if (position === needle.length) return true;
    }
    return false;
  }

  function assertMysql(result, contextDbType = "") {
    const firstRow = objectRows(result)[0] ?? {};
    const version = firstRow.version ?? firstRow.VERSION ?? "";
    const versionComment = firstRow.version_comment ?? firstRow.VERSION_COMMENT ?? "";
    const dbType = String(result?.dbType ?? contextDbType).toLowerCase();
    if (dbType) {
      if (dbType.includes("mysql") || dbType.includes("mariadb")) return;
      throw new Error("当前连接不是 MySQL 或 MariaDB。请从 MySQL 表的右键菜单打开插件。");
    }
    const serverType = `${version} ${versionComment}`;
    if (serverType.trim() && !/mysql|mariadb|percona/i.test(serverType)) {
      throw new Error("当前连接不是 MySQL 或 MariaDB。请从 MySQL 表的右键菜单打开插件。");
    }
  }

  async function query(sql, selectedDatabase, maxRows = 1000) {
    try {
      return await plugin.queryData({
        connectionId,
        ...(selectedDatabase ? { database: selectedDatabase } : {}),
        sql,
        maxRows
      });
    } catch (cause) {
      if (isClosedConnectionError(cause)) connectionStatus = "closed";
      throw cause;
    }
  }

  async function loadColumns() {
    loading = true;
    error = "";
    notice = "";
    columns = [];
    sql = "";
    try {
      if (!connectionId || !database || !tableName) throw new Error("请先选择数据库和数据表。");
      const schema = escText(database);
      const table = escText(tableName);
      const result = await query(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION, COLUMN_KEY, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`, database);
      columns = objectRows(result).map((row) => ({
        name: valueOf(row, "COLUMN_NAME"),
        type: String(valueOf(row, "COLUMN_TYPE") ?? "").toLowerCase(),
        nullable: String(valueOf(row, "IS_NULLABLE")).toUpperCase() === "YES",
        hasDefault: valueOf(row, "COLUMN_DEFAULT") !== null && valueOf(row, "COLUMN_DEFAULT") !== undefined,
        extra: String(valueOf(row, "EXTRA") ?? "").toLowerCase(),
        length: Number(valueOf(row, "CHARACTER_MAXIMUM_LENGTH")) || 0,
        precision: Number(valueOf(row, "NUMERIC_PRECISION")) || 0,
        scale: Number(valueOf(row, "NUMERIC_SCALE")) || 0,
        key: String(valueOf(row, "COLUMN_KEY") ?? "").toUpperCase(),
        comment: valueOf(row, "COLUMN_COMMENT") ?? ""
      })).filter((column) => column.name);
      if (!columns.length) throw new Error("未读取到表字段，请确认表名和当前数据库。");
      try {
        await analyzeExistingData();
      } catch {
        profiles = {};
        profileSampleCount = 0;
      }
      notice = profileSampleCount
        ? `已读取 ${columns.length} 个字段，并分析 ${profileSampleCount} 条现有记录来拟合数据分布。`
        : `已读取 ${columns.length} 个字段；表中暂无可用样本，将使用字段类型和名称生成数据。`;
    } catch (cause) {
      if (isClosedConnectionError(cause)) connectionStatus = "closed";
      error = cause?.message ?? "读取表结构失败。";
    } finally {
      loading = false;
    }
  }

  function isClosedConnectionError(cause) {
    const message = String(cause?.message ?? cause ?? "").toLowerCase();
    return message.includes("connection is not open") || message.includes("connection closed") || message.includes("connection is closed");
  }

  async function refreshConnection() {
    loading = true;
    error = "";
    notice = "正在刷新连接状态和库表信息…";
    connectionStatus = "checking";
    try {
      if (!plugin) {
        plugin = window.dbxPlugin;
        await plugin?.ready;
      }
      try {
        const latest = await plugin.request("host.getContext", {});
        context = latest?.context ?? latest ?? plugin.context ?? context ?? {};
      } catch {
        context = plugin?.context ?? context ?? {};
      }
      connectionId = context.connectionId || context.id || connectionId;
      if (!connectionId) throw new Error("请从 DBX 的 MySQL 连接右键打开此插件。");

      const identity = await query("SELECT DATABASE() AS database_name, VERSION() AS version, @@version_comment AS version_comment", database);
      assertMysql(identity, context.dbType);
      connectionStatus = "open";
      const schemas = await query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME");
      const systemSchemas = new Set(["information_schema", "mysql", "performance_schema", "sys"]);
      databaseOptions = objectRows(schemas).map((row) => valueOf(row, "SCHEMA_NAME")).filter((name) => name && !systemSchemas.has(String(name).toLowerCase()));
      const preferredDatabase = database || context.database || context.schema || "";
      database = databaseOptions.includes(preferredDatabase) ? preferredDatabase : (databaseOptions[0] ?? "");
      await loadTables(tableName);
      notice = "连接状态和库表信息已刷新。";
    } catch (cause) {
      connectionStatus = isClosedConnectionError(cause) ? "closed" : "error";
      error = connectionStatus === "closed"
        ? "当前 DBX 连接已关闭。请先在 DBX 侧边栏重新连接 MySQL，再点击“刷新连接”。"
        : (cause?.message ?? "刷新连接失败。");
      notice = "";
    } finally {
      loading = false;
    }
  }

  async function analyzeExistingData() {
    profiles = {};
    profileSampleCount = 0;
    const sampleColumns = columns.filter((column) =>
      !column.extra.includes("auto_increment") &&
      !column.extra.includes("generated") &&
      !/^(?:tinyblob|blob|mediumblob|longblob|binary|varbinary)/.test(column.type)
    ).slice(0, 80);
    if (!sampleColumns.length) return;

    const selection = sampleColumns.map((column) => {
      const identifier = escId(column.name);
      if (column.type === "json") return `JSON_KEYS(${identifier}) AS ${escId(`${column.name}__sample_keys`)}`;
      const expression = /^(?:tinytext|text|mediumtext|longtext)/.test(column.type)
        ? `LEFT(CAST(${identifier} AS CHAR), 256)`
        : identifier;
      return `${expression} AS ${identifier}`;
    }).join(", ");
    const orderColumn = pickSampleOrderColumn();
    const ordering = orderColumn ? ` ORDER BY ${escId(orderColumn.name)} DESC` : "";
    const result = await query(`SELECT ${selection} FROM ${escId(database)}.${escId(tableName)}${ordering} LIMIT 100`, database, 100);
    const rows = objectRows(result);
    profileSampleCount = rows.length;
    if (!rows.length) return;

    for (const column of sampleColumns) {
      const sampleField = column.type === "json" ? `${column.name}__sample_keys` : column.name;
      const values = rows.map((row) => valueOf(row, sampleField)).filter((value) => value !== null && value !== undefined);
      profiles[column.name] = analyzeColumn(column, values, rows.length);
    }
  }

  function pickSampleOrderColumn() {
    const primary = columns.find((column) => column.key === "PRI");
    if (primary) return primary;
    const normalized = (column) => String(column.name).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const exactId = columns.find((column) => normalized(column) === "id");
    if (exactId) return exactId;
    const timePriority = [
      /(?:^|_)(?:create_time|created_time|create_date|created_at|created_on|gmt_create)(?:$|_)/,
      /(?:^|_)(?:update_time|updated_time|update_date|updated_at|updated_on|gmt_modified)(?:$|_)/,
      /(?:^|_)(?:modify_time|modified_time|modify_date|modified_at|modified_on|last_modified)(?:$|_)/
    ];
    for (const pattern of timePriority) {
      const match = columns.find((column) => pattern.test(normalized(column)));
      if (match) return match;
    }
    return null;
  }

  function isSensitiveField(column) {
    return /(?:password|passwd|secret|token|credential|email|e_mail|phone|mobile|telephone|address|real.?name|user.?name|customer.?name|身份证|银行卡)/i.test(`${column.name} ${column.comment}`);
  }

  function isSensitiveValue(value) {
    const text = String(value);
    return /@|https?:\/\//i.test(text) || /^\+?[\d ()-]{7,}$/.test(text) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text) || text.length > 64;
  }

  function analyzeColumn(column, values, rowCount) {
    const frequencies = new Map();
    const numbers = [];
    const dates = [];
    const lengths = [];
    const patterns = new Map();
    const emailDomains = new Map();
    const jsonKeys = new Map();
    for (const value of values) {
      const key = String(value);
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
      if (/email|e_mail/i.test(column.name) && key.includes("@")) {
        const domain = key.split("@").at(-1).toLowerCase();
        emailDomains.set(domain, (emailDomains.get(domain) ?? 0) + 1);
      }
      if (column.type === "json") {
        try {
          const parsed = Array.isArray(value) ? value : JSON.parse(key);
          if (Array.isArray(parsed)) for (const item of parsed) if (typeof item === "string") jsonKeys.set(item, (jsonKeys.get(item) ?? 0) + 1);
        } catch { /* Ignore malformed or truncated JSON key samples. */ }
      }
      if (typeof value === "number" || /^-?\d+(?:\.\d+)?$/.test(key)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) numbers.push(numeric);
      }
      if (/^(?:date|datetime|timestamp)/.test(column.type)) {
        const timestamp = Date.parse(String(value).replace(" ", "T"));
        if (Number.isFinite(timestamp)) dates.push(timestamp);
      } else if (column.type.startsWith("time")) {
        const timestamp = Date.parse(`1970-01-01T${String(value)}`);
        if (Number.isFinite(timestamp)) dates.push(timestamp);
      }
      if (typeof value === "string") {
        lengths.push(value.length);
        const pattern = value.replace(/[A-Z]/g, "A").replace(/[a-z]/g, "a").replace(/\d/g, "9").replace(/[^\x00-\x7F]/g, "中");
        patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
      }
    }

    const sensitive = isSensitiveField(column);
    const semanticCategory = /(?:status|state|type|category|kind|level|flag|enabled|deleted|source|role|channel|mode|gender|priority)/i.test(column.name);
    const avgLength = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
    const simpleScalar = !/^(?:tinytext|text|mediumtext|longtext|json|.*blob|.*binary)/.test(column.type);
    const lowCardinality = simpleScalar && frequencies.size > 0 && frequencies.size <= 16 && avgLength <= 48;
    const categoricalType = /^(?:enum|set|char|varchar|tinyint|smallint|boolean|bool)/.test(column.type);
    const categories = simpleScalar && !sensitive && (semanticCategory || (lowCardinality && categoricalType))
      ? [...frequencies.entries()]
          .filter(([value]) => !isSensitiveValue(value))
          .map(([value, count]) => ({ value, count }))
      : [];

    return {
      nullRate: rowCount ? 1 - values.length / rowCount : 0,
      min: numbers.length ? Math.min(...numbers) : null,
      max: numbers.length ? Math.max(...numbers) : null,
      dateMin: dates.length ? Math.min(...dates) : null,
      dateMax: dates.length ? Math.max(...dates) : null,
      avgLength,
      minLength: lengths.length ? Math.min(...lengths) : 0,
      maxLength: lengths.length ? Math.max(...lengths) : 0,
      categories,
      patterns: [...patterns.entries()].map(([pattern, count]) => ({ pattern, count })),
      emailDomains: [...emailDomains.entries()].map(([domain, count]) => ({ value: domain, count })),
      jsonKeys: [...jsonKeys.entries()].sort((left, right) => right[1] - left[1]).slice(0, 16).map(([key, count]) => ({ value: key, count }))
    };
  }

  async function loadTables(preferredTable = "") {
    tableOptions = [];
    tableName = "";
    tableSearch = "";
    columns = [];
    sql = "";
    if (!database) return;
    const schema = escText(database);
    const result = await query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, database);
    tableOptions = objectRows(result).map((row) => valueOf(row, "TABLE_NAME")).filter(Boolean);
    tableName = tableOptions.includes(preferredTable) ? preferredTable : "";
    if (tableName) await loadColumns();
  }

  async function changeDatabase(nextDatabase) {
    database = nextDatabase;
    databaseSearch = "";
    loading = true;
    error = "";
    try {
      await loadTables();
    } catch (cause) {
      if (isClosedConnectionError(cause)) connectionStatus = "closed";
      error = cause?.message ?? "读取数据表列表失败。";
    } finally {
      loading = false;
    }
  }

  async function changeTable(nextTable) {
    tableName = nextTable;
    tableSearch = "";
    sql = "";
    await loadColumns();
  }

  async function chooseDatabase(nextDatabase) {
    databaseOpen = false;
    databaseSearch = "";
    await changeDatabase(nextDatabase);
  }

  async function chooseTable(nextTable) {
    tableOpen = false;
    tableSearch = "";
    await changeTable(nextTable);
  }

  async function initialize() {
    loading = true;
    error = "";
    try {
      plugin = window.dbxPlugin;
      await plugin?.ready;
      context = plugin?.context ?? {};
      connectionId = context.connectionId || context.id || "";
      database = context.database ?? context.schema ?? "";
      tableName = context.table ?? context.tableName ?? "";
      if (!connectionId) {
        throw new Error("请在 DBX 侧边栏的 MySQL 连接上右键打开插件，再在界面选择数据库和数据表。");
      }
      const identity = await query("SELECT DATABASE() AS database_name, VERSION() AS version, @@version_comment AS version_comment", database);
      assertMysql(identity, context.dbType);
      connectionStatus = "open";
      const identityRow = objectRows(identity)[0] ?? {};
      const currentDatabase = database || identityRow.database_name || identityRow.DATABASE_NAME || "";
      const schemas = await query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME");
      const systemSchemas = new Set(["information_schema", "mysql", "performance_schema", "sys"]);
      databaseOptions = objectRows(schemas)
        .map((row) => valueOf(row, "SCHEMA_NAME"))
        .filter((name) => name && !systemSchemas.has(String(name).toLowerCase()));
      if (!databaseOptions.length) throw new Error("当前连接没有可访问的 MySQL 数据库。");
      database = databaseOptions.includes(currentDatabase) ? currentDatabase : databaseOptions[0];
      await loadTables(tableName);
      if (!tableName) notice = "请选择数据库和数据表，然后生成 INSERT SQL。";
    } catch (cause) {
      connectionStatus = isClosedConnectionError(cause) ? "closed" : "error";
      error = cause?.message ?? "初始化插件失败。";
    } finally {
      loading = false;
    }
  }

  function randomFor(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function weightedPick(items, random) {
    if (!items?.length) return undefined;
    const total = items.reduce((sum, item) => sum + (item.count ?? 1), 0);
    let target = random() * total;
    for (const item of items) {
      target -= item.count ?? 1;
      if (target < 0) return item.value;
    }
    return items.at(-1).value;
  }

  function generatePattern(pattern, random) {
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const digits = "0123456789";
    const chinese = ["明", "华", "新", "安", "云", "海", "星", "林", "文", "佳", "宁", "远"];
    return [...pattern].map((character) => {
      if (character === "a") return lower[Math.floor(random() * lower.length)];
      if (character === "A") return upper[Math.floor(random() * upper.length)];
      if (character === "9") return digits[Math.floor(random() * digits.length)];
      if (character === "中") return chinese[Math.floor(random() * chinese.length)];
      return character;
    }).join("");
  }

  function isAuditTimeField(column) {
    const name = String(column.name).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    return /(?:^|_)(?:create|created|update|updated|modify|modified|last_update|last_modified|gmt_create|gmt_modified)(?:_|$)/.test(name)
      && /(?:date|time|timestamp|_at$|_on$|_ts$)/.test(name);
  }

  function currentTimeValue(column) {
    const type = column.type;
    if (/^date(?:\(|$)/.test(type)) return "CURRENT_DATE";
    if (/^time(?:\(|$)/.test(type)) return "CURRENT_TIME";
    if (/^(?:datetime|timestamp)/.test(type)) return "CURRENT_TIMESTAMP";
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    return `'${date} ${time}'`;
  }

  function makeValue(column, index, random, profile = {}, engine = generatorId) {
    const type = column.type;
    const name = String(column.name).toLowerCase();
    const chinese = fakerLocale === "zh_CN" || (fakerLocale === "auto" && profile.patterns?.some((item) => item.pattern.includes("中")));
    const faker = chinese ? fakerZH_CN : fakerEN;
    if (isAuditTimeField(column)) return currentTimeValue(column);
    if (column.nullable && random() < Math.max(0, Math.min(0.6, profile.nullRate ?? 0.04))) return "NULL";
    const pick = (items) => items[Math.floor(random() * items.length)];
    const quoted = (value) => `'${escText(value)}'`;
    const enumMatch = type.match(/^(?:enum|set)\((.*)\)$/i);
    if (enumMatch) {
      const options = [...enumMatch[1].matchAll(/'((?:\\.|[^'])*)'/g)].map((match) => match[1].replaceAll("\\'", "'").replaceAll("\\\\", "\\"));
      const observedOptions = profile.categories?.filter((item) => options.includes(String(item.value)));
      if (observedOptions?.length) return quoted(weightedPick(observedOptions, random));
      if (options.length) return quoted(pick(options));
    }
    const uniqueIntegerKey = /^(tinyint|smallint|mediumint|int|integer|bigint|year)/.test(type) && ["PRI", "UNI"].includes(column.key);
    if (uniqueIntegerKey && Number.isFinite(profile.max)) return String(Math.floor(profile.max) + index + 1);
    if (profile.categories?.length && !["PRI", "UNI"].includes(column.key)) {
      const category = weightedPick(profile.categories, random);
      if (/^(tinyint|smallint|mediumint|int|integer|bigint|year|decimal|numeric|float|double|real|bool|boolean|bit)/.test(type)) return String(category);
      return quoted(category);
    }
    if (/^(tinyint|smallint|mediumint|int|integer|bigint|year)/.test(type)) {
      if (Number.isFinite(profile.min) && Number.isFinite(profile.max)) {
        if (profile.min === profile.max) return String(Math.floor(profile.min));
        return String(Math.floor(profile.min + random() * (profile.max - profile.min + 1)));
      }
      const value = /(?:^|_)(?:id|count|age|quantity|num|status)(?:$|_)/.test(name) ? index + 1 : Math.floor(random() * 10000);
      return String(value);
    }
    if (/^(decimal|numeric|float|double|real)/.test(type)) {
      const scale = Math.min(column.scale, 6);
      const min = profile.min ?? 0;
      const max = profile.max ?? 10000;
      return (min + random() * (max - min || 10000)).toFixed(scale);
    }
    if (/^(bool|boolean)/.test(type)) return random() < 0.5 ? "0" : "1";
    if (/^bit/.test(type)) return random() < 0.5 ? "b'0'" : "b'1'";
    if (/^(date|datetime|timestamp|time)/.test(type)) {
      const low = profile.dateMin ?? Date.UTC(2020, 0, 1);
      const high = profile.dateMax ?? Date.now();
      const timestamp = low + random() * Math.max(0, high - low);
      const date = new Date(timestamp);
      const day = String(date.getUTCDate()).padStart(2, "0");
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const hour = String(date.getUTCHours()).padStart(2, "0");
      const minute = String(date.getUTCMinutes()).padStart(2, "0");
      const second = String(date.getUTCSeconds()).padStart(2, "0");
      if (type.startsWith("date")) return quoted(`${date.getUTCFullYear()}-${month}-${day}`);
      if (type.startsWith("time")) return quoted(`${hour}:${minute}:${second}`);
      return quoted(`${date.getUTCFullYear()}-${month}-${day} ${hour}:${minute}:${second}`);
    }
    if (/^json/.test(type)) {
      const sample = {};
      for (const item of profile.jsonKeys ?? []) {
        const key = String(item.value);
        if (/^(?:is_|has_|enabled|active|deleted)/i.test(key)) sample[key] = random() < 0.5;
        else if (/(?:amount|price|count|quantity|total|rate)$/i.test(key)) sample[key] = Math.round(random() * 10000) / 100;
        else if (/(?:date|time|created|updated)_?at$/i.test(key)) sample[key] = new Date(Date.now() - Math.floor(random() * 365 * 86400000)).toISOString();
        else sample[key] = `mock_${key}_${index + 1}`;
      }
      if (!Object.keys(sample).length) sample.value = `mock-${index + 1}`;
      return quoted(JSON.stringify(sample));
    }
    if (/blob|binary/.test(type)) return "X''";
    let value;
    if (engine === "chance" && /(?:^|_)(?:uuid|guid)(?:$|_)/.test(name)) value = chanceGenerator.guid();
    else if (engine === "chance" && /(?:^|_)(?:first_name|firstname)(?:$|_)/.test(name)) value = chanceGenerator.first();
    else if (engine === "chance" && /(?:^|_)(?:last_name|lastname|surname)(?:$|_)/.test(name)) value = chanceGenerator.last();
    else if (engine === "chance" && /name|姓名/.test(name)) value = chanceGenerator.name();
    else if (engine === "chance" && /(?:^|_)(?:company|organization|org_name)(?:$|_)/.test(name)) value = chanceGenerator.company();
    else if (engine === "chance" && /(?:^|_)(?:city|province|country)(?:$|_)/.test(name)) value = chanceGenerator.city();
    else if (engine === "chance" && /address/.test(name)) value = chanceGenerator.address();
    else if (engine === "chance" && /(?:^|_)(?:url|website|uri)(?:$|_)/.test(name)) value = chanceGenerator.url();
    else if (engine === "chance" && /email|e_mail/.test(name)) value = chanceGenerator.email();
    else if (engine === "chance" && /phone|mobile|telephone|tel/.test(name)) value = chanceGenerator.phone();
    else if (engine === "chance" && /(?:^|_)(?:username|account_name|login_name)(?:$|_)/.test(name)) value = chanceGenerator.word();
    else if (engine === "chance" && /(?:^|_)(?:job|job_title|occupation)(?:$|_)/.test(name)) value = chanceGenerator.word();
    else if (engine === "chance") value = chanceGenerator.sentence({ words: 3 });
    else if (engine === "faker" && /(?:^|_)(?:uuid|guid)(?:$|_)/.test(name)) value = faker.string.uuid();
    else if (engine === "faker" && /(?:^|_)(?:first_name|firstname)(?:$|_)/.test(name)) value = faker.person.firstName();
    else if (engine === "faker" && /(?:^|_)(?:last_name|lastname|surname)(?:$|_)/.test(name)) value = faker.person.lastName();
    else if (engine === "faker" && /name|姓名/.test(name)) value = faker.person.fullName();
    else if (engine === "faker" && /(?:^|_)(?:company|organization|org_name)(?:$|_)/.test(name)) value = faker.company.name();
    else if (engine === "faker" && /(?:^|_)(?:city|province|country)(?:$|_)/.test(name)) value = faker.location.city();
    else if (engine === "faker" && /address/.test(name)) value = faker.location.streetAddress();
    else if (engine === "faker" && /(?:^|_)(?:url|website|uri)(?:$|_)/.test(name)) value = faker.internet.url();
    else if (engine === "faker" && /(?:^|_)(?:username|account_name|login_name)(?:$|_)/.test(name)) value = faker.internet.username();
    else if (engine === "faker" && /(?:^|_)(?:job|job_title|occupation)(?:$|_)/.test(name)) value = faker.person.jobTitle();
    else if (engine === "faker" && /email|e_mail/.test(name)) {
      const domain = weightedPick(profile.emailDomains, random);
      value = domain ? `user${index + 1}@${domain}` : faker.internet.email();
    }
    else if (engine === "faker" && /phone|mobile|telephone|tel/.test(name)) value = faker.phone.number();
    else if (/email|e_mail/.test(name)) {
      const domain = weightedPick(profile.emailDomains, random) ?? "example.test";
      value = `user${index + 1}@${domain}`;
    }
    else if (/phone|mobile|tel/.test(name)) {
      const length = Math.max(7, Math.min(15, Math.round(profile.avgLength || 11)));
      const first = length === 11 && profile.patterns?.some((item) => item.pattern.startsWith("1")) ? "1" : String(1 + Math.floor(random() * 9));
      value = first + Array.from({ length: length - 1 }, () => Math.floor(random() * 10)).join("");
    }
    else if (/url|website|uri/.test(name)) value = `https://example.test/item/${index + 1}`;
    else if (/name/.test(name)) {
      const chineseName = profile.patterns?.some((item) => item.pattern.includes("中"));
      value = chineseName ? pick(["张伟", "王芳", "李娜", "陈明", "赵敏", "刘洋"]) : pick(["Alex Morgan", "Taylor Smith", "Jordan Lee", "Casey Chen"]);
    }
    else if (/address|city/.test(name)) value = pick(["100 Market Street", "25 River Road", "8 Garden Avenue"]);
    else if (profile.patterns?.length) {
      const pattern = weightedPick(profile.patterns.map((item) => ({ value: item.pattern, count: item.count })), random);
      value = generatePattern(pattern ?? "", random);
    }
    else value = engine === "faker" ? faker.lorem.words(3) : `mock_${column.name}_${index + 1}`;
    if (column.length > 0) value = value.slice(0, column.length);
    return quoted(value);
  }

  function generate() {
    error = "";
    copied = false;
    if (!database || !tableName || !columns.length) {
      error = "请先选择数据库和数据表，并读取到字段信息。";
      return;
    }
    const count = Math.max(1, Math.min(maxRows, Math.floor(Number(rowCount) || 1)));
    rowCount = count;
    if (selectedGenerator.kind !== "builtin") {
      sql = "";
      notice = `${selectedGenerator.name} 需要在终端运行；安装方式与根据当前表生成的命令已显示在 SQL 预览区。`;
      return;
    }
    const insertable = columns.filter((column) => !column.extra.includes("auto_increment") && !column.extra.includes("generated"));
    if (!insertable.length) {
      error = "所有字段均为自增列或生成列，当前没有可写入的字段。";
      sql = "";
      return;
    }
    generating = true;
    try {
      const random = randomFor(Date.now() ^ count);
      const fakerSeed = Date.now() ^ count;
      fakerEN.seed(fakerSeed);
      fakerZH_CN.seed(fakerSeed);
      chanceGenerator = new Chance(chanceSeed.trim() === "" ? fakerSeed : Number(chanceSeed));
      const values = Array.from({ length: count }, (_, index) => `  (${insertable.map((column) => makeValue(column, index, random, profiles[column.name], generatorId)).join(", ")})`).join(",\n");
      sql = `-- Generated by MySQL Mock Data. Review constraints and foreign keys before execution.\nINSERT INTO ${escId(database)}.${escId(tableName)} (${insertable.map((column) => escId(column.name)).join(", ")})\nVALUES\n${values};`;
      notice = `已生成 ${count} 行 INSERT SQL${profileSampleCount ? `，参考了 ${profileSampleCount} 条现有记录的分布和格式` : "，使用字段规则生成"}。插件仅生成文本，不会执行写入。`;
    } catch (cause) {
      error = cause?.message ?? "生成 SQL 失败。";
    } finally {
      generating = false;
    }
  }

  async function copySql() {
    if (!sql) return;
    try {
      if (plugin?.copy) await plugin.copy(sql);
      else await navigator.clipboard.writeText(sql);
      copied = true;
      setTimeout(() => copied = false, 1800);
    } catch {
      error = "复制失败，请手动选中 SQL 复制。";
    }
  }

  async function copyGeneratorCommand() {
    if (!generatorCommand || generatorCommand.startsWith("先选择")) return;
    try {
      if (plugin?.copy) await plugin.copy(generatorCommand);
      else await navigator.clipboard.writeText(generatorCommand);
      notice = "生成器命令已复制。";
    } catch {
      error = "复制失败，请手动选中生成器命令复制。";
    }
  }

  function downloadSql() {
    if (!sql) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([sql], { type: "application/sql;charset=utf-8" }));
    link.download = `${tableName || "mock-data"}.sql`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  onMount(initialize);
</script>

<svelte:head>
  <title>MySQL Mock Data</title>
</svelte:head>

<main>
  <header>
    <div class="eyebrow">DBX · MYSQL</div>
    <h1>Mock 数据生成</h1>
    <p>选择生成器后查看 SQL 预览，或复制该工具的安装与运行命令</p>
  </header>

  {#if loading}
    <section class="state">正在读取表结构…</section>
  {:else if error && !connectionId}
    <section class="state error">{error}</section>
    <button class="secondary" onclick={initialize}>重试</button>
  {:else}
    <section class="card selectors">
      <div class="picker">
        <label for="database-search">数据库</label>
        <input id="database-search" type="search" role="combobox" aria-label="搜索并选择数据库" aria-expanded={databaseOpen} aria-controls="database-options" placeholder={database || "搜索或选择数据库…"} value={databaseOpen ? databaseSearch : database} onfocus={() => { databaseSearch = ""; databaseOpen = true; }} oninput={(event) => { databaseSearch = event.currentTarget.value; databaseOpen = true; }} onblur={() => setTimeout(() => { databaseOpen = false; databaseSearch = ""; }, 150)} onkeydown={(event) => { if (event.key === "Escape") databaseOpen = false; }} />
        {#if databaseOpen}
          <div class="suggestions" id="database-options" role="listbox" aria-label="数据库建议">
            {#each databaseOptions.filter((item) => matchesSearch(item, databaseSearch)) as item}
              <button type="button" role="option" aria-selected={database === item} onmousedown={(event) => event.preventDefault()} onclick={() => chooseDatabase(item)}>{item}</button>
            {:else}<span class="empty-option">没有匹配的数据库</span>{/each}
          </div>
        {/if}
      </div>
      <div class="picker">
        <label for="table-search">数据表</label>
        <input id="table-search" type="search" role="combobox" aria-label="搜索并选择数据表" aria-expanded={tableOpen} aria-controls="table-options" placeholder={tableName || (database ? "搜索或选择数据表…" : "请先选择数据库")} value={tableOpen ? tableSearch : tableName} disabled={!database} onfocus={() => { tableSearch = ""; tableOpen = true; }} oninput={(event) => { tableSearch = event.currentTarget.value; tableOpen = true; }} onblur={() => setTimeout(() => { tableOpen = false; tableSearch = ""; }, 150)} onkeydown={(event) => { if (event.key === "Escape") tableOpen = false; }} />
        {#if tableOpen && database}
          <div class="suggestions" id="table-options" role="listbox" aria-label="数据表建议">
            {#each tableOptions.filter((item) => matchesSearch(item, tableSearch)) as item}
              <button type="button" role="option" aria-selected={tableName === item} onmousedown={(event) => event.preventDefault()} onclick={() => chooseTable(item)}>{item}</button>
            {:else}<span class="empty-option">没有匹配的数据表</span>{/each}
          </div>
        {/if}
      </div>
    </section>
    {#if error}<p class="error inline-error">{error}</p>{/if}

    <section class="card meta">
      <div><span>连接</span><strong>{context?.name ?? context?.connectionName ?? connectionId}</strong></div>
      <div><span>数据库</span><strong>{database}</strong></div>
      <div><span>数据表</span><strong>{tableName}</strong></div>
      <div><span>字段</span><strong>{columns.length}</strong></div>
      <div class="connection-refresh">
        <span class:status-open={connectionStatus === "open"} class:status-closed={connectionStatus === "closed"}>{connectionStatus === "open" ? "连接正常" : connectionStatus === "closed" ? "连接已关闭" : connectionStatus === "checking" ? "检查中" : "连接状态未知"}</span>
        <button class="secondary compact-refresh" title="刷新连接" aria-label="刷新连接" onclick={refreshConnection} disabled={loading}>{loading ? "…" : "↻"}</button>
      </div>
    </section>

    <section class="card rules">
      <div class="rules-title"><strong>生成规则</strong><span>设置生成器和数据条数</span></div>
      <div class="rules-grid">
        <div class="generator-picker">
          <label for="generator">生成器</label>
          <select id="generator" bind:value={generatorId} onchange={() => { sql = ""; copied = false; notice = ""; }}>
            {#each generators as item}<option value={item.id}>{item.name}{item.kind === "builtin" ? (item.id === "builtin" ? "（默认）" : "（内置）") : item.kind === "web" ? "（网页工具）" : item.kind === "node-api" ? "（Node.js API）" : "（外部工具）"}</option>{/each}
          </select>
          <small class="generator-tip">{selectedGenerator.description}</small>
          {#if generatorId === "faker"}
            <div class="engine-config">
              <label for="faker-locale">语言</label>
              <select id="faker-locale" bind:value={fakerLocale}><option value="auto">跟随样本自动判断</option><option value="zh_CN">中文</option><option value="en">English</option></select>
              <small>随机种子由每次生成自动设置，保证本次批量值的随机性。</small>
            </div>
          {:else if generatorId === "chance"}
            <div class="engine-config">
              <label for="chance-seed">随机种子</label>
              <input id="chance-seed" type="text" placeholder="留空则每次随机" bind:value={chanceSeed} />
              <small>填入固定种子可重复生成相同数据。</small>
            </div>
          {/if}
        </div>
        <div class="count-picker">
          <label for="row-count">生成条数（最多 {maxRows}）</label>
          <input id="row-count" type="number" min="1" max={maxRows} bind:value={rowCount} />
        </div>
        <button class="primary" onclick={generate} disabled={generating || !columns.length}>{generating ? "生成中…" : selectedGenerator.kind === "builtin" ? "生成 INSERT SQL" : selectedGenerator.kind === "web" ? "查看使用步骤" : "查看命令"}</button>
      </div>
    </section>

    {#if notice}<p class="notice">{notice}</p>{/if}
    <section class="card output">
      <div class="output-head">
        <strong>{selectedGenerator.kind === "builtin" ? "SQL 预览" : `SQL 预览 · ${selectedGenerator.name} 安装与运行`}</strong>
        <div class="actions">
          {#if selectedGenerator.kind === "builtin"}
            <button class="secondary" onclick={copySql} disabled={!sql}>{copied ? "已复制" : "复制 SQL"}</button>
            <button class="secondary" onclick={downloadSql} disabled={!sql}>下载 .sql</button>
          {:else}
            {#if selectedGenerator.source}<a class="generator-source" href={selectedGenerator.source} target="_blank" rel="noreferrer">项目主页 ↗</a>{/if}
            <button class="secondary" onclick={copyGeneratorCommand} disabled={!database || !tableName}>复制命令</button>
          {/if}
        </div>
      </div>
      {#if selectedGenerator.kind === "builtin"}
        <textarea aria-label="生成的 SQL" readonly placeholder="设置行数后点击“生成 INSERT SQL”" bind:value={sql}></textarea>
      {:else}
        <div class="generator-guide">
          <p class="generator-description">{selectedGenerator.description}</p>
          <small class="generator-install">安装方式：{selectedGenerator.install}</small>
          <textarea aria-label="所选生成器的安装与执行命令" readonly value={generatorCommand}></textarea>
          {#if selectedGenerator.kind === "cli-limited" || selectedGenerator.kind === "cli-unverified"}<p class="generator-warning">该工具的输出/写入范围如上方说明；外部 CLI 由你在终端执行，运行前请确认目标库和写入范围。</p>{/if}
        </div>
      {/if}
    </section>
    <p class="footnote">内置生成器、Faker.js 和 Chance.js 会在插件中生成 INSERT SQL；外部 CLI 仅显示命令，不会由插件代为启动。直接写入型工具须在运行前核对目标库与影响范围。</p>
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { color-scheme: light; }
  :global(html[data-dbx-theme="dark"]) { color-scheme: dark; }
  :global(body) { margin: 0; background: var(--color-background, #f5f7fa); color: var(--color-foreground, #172033); font: 14px/1.5 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { width: min(900px, 100%); margin: 0 auto; padding: 32px 24px 40px; }
  header { margin: 0 0 22px; }
  .eyebrow { color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: .14em; }
  h1 { margin: 5px 0 2px; font-size: 25px; letter-spacing: -.03em; }
  header p { margin: 0; color: #64748b; }
  .card { border: 1px solid var(--color-border, #e4e8ef); border-radius: 10px; background: var(--color-card, var(--color-background, #fff)); }
  .selectors { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 14px 0; padding: 14px 16px; }
  .picker { position: relative; display: grid; grid-template-columns: 1fr; gap: 6px; min-width: 0; }
  .picker input { width: 100%; }
  .suggestions { position: absolute; z-index: 5; top: calc(100% - 1px); right: 0; left: 0; max-height: 240px; overflow: auto; padding: 4px; border: 1px solid var(--color-border, #d6dce5); border-radius: 7px; background: var(--color-popover, var(--color-background, white)); box-shadow: 0 8px 24px #1720331a; }
  .suggestions button { display: block; width: 100%; height: auto; min-height: 34px; padding: 7px 9px; border: 0; background: transparent; color: var(--color-foreground, #25334a); text-align: left; font-weight: 400; }
  .suggestions button:hover, .suggestions button[aria-selected="true"] { background: var(--color-accent, #eff6ff); color: var(--color-accent-foreground, #1d4ed8); }
  .empty-option { display: block; padding: 9px; color: #718096; font-size: 12px; }
  .meta { display: grid; grid-template-columns: 1.3fr 1fr 1fr 70px; gap: 12px; padding: 15px 17px; }
  .meta div { min-width: 0; display: grid; gap: 3px; }
  .meta span, label { color: #718096; font-size: 12px; }
  .meta strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .connection-refresh { display: flex; align-items: center; gap: 8px; grid-column: 1 / -1; padding-top: 2px; }
  .connection-refresh span { margin-right: auto; color: #718096; font-size: 11px; }
  .connection-refresh .status-open { color: #16803c; }
  .connection-refresh .status-closed { color: #b42318; }
  .compact-refresh { width: 24px; height: 24px; padding: 0; border-color: var(--color-border, #e4e8ef); color: var(--color-muted-foreground, #64748b); font-size: 14px; font-weight: 500; }
  .rules { margin-top: 14px; padding: 14px 16px; }
  .rules-title { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
  .rules-title span { color: #718096; font-size: 11px; }
  .rules-grid { display: grid; grid-template-columns: minmax(250px, 1fr) minmax(130px, 180px) auto; align-items: start; gap: 16px; }
  .generator-picker { display: grid; gap: 5px; min-width: 0; flex: 1; }
  .generator-picker select { width: 100%; max-width: 330px; height: 36px; padding: 0 10px; border: 1px solid var(--color-border, #d6dce5); border-radius: 6px; background: var(--color-background, white); color: var(--color-foreground, #172033); font: inherit; }
  .generator-tip { max-width: 560px; color: #718096; font-size: 11px; line-height: 1.45; }
  .engine-config { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 3px; }
  .engine-config label, .engine-config small { color: #718096; font-size: 11px; }
  .engine-config select, .engine-config input { width: auto; min-width: 150px; height: 30px; padding: 0 8px; border: 1px solid var(--color-border, #d6dce5); border-radius: 5px; background: var(--color-background, white); color: var(--color-foreground, #172033); font: inherit; }
  .count-picker { display: grid; gap: 5px; }
  input { width: 100px; height: 36px; padding: 0 10px; border: 1px solid var(--color-border, #d6dce5); border-radius: 6px; background: var(--color-background, white); color: var(--color-foreground, #172033); font: inherit; }
  button { height: 36px; padding: 0 13px; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .45; }
  .primary { margin-left: auto; border: 1px solid var(--color-primary, #2563eb); background: var(--color-primary, #2563eb); color: var(--color-primary-foreground, white); }
  .secondary { border: 1px solid var(--color-border, #d6dce5); background: var(--color-background, #fff); color: var(--color-foreground, #334155); }
  .notice { margin: 12px 2px; color: #64748b; font-size: 12px; }
  .output { margin-top: 10px; overflow: hidden; }
  .generator-guide { display: grid; gap: 10px; padding: 14px; }
  .generator-description { margin: 0; color: #718096; font-size: 11px; }
  .generator-source { align-self: center; color: #2563eb; font-size: 11px; text-decoration: none; }
  .generator-install { color: #64748b; font-size: 11px; }
  .generator-guide textarea { min-height: 260px; border: 1px solid var(--color-border, #e4e8ef); border-radius: 6px; }
  .generator-warning { margin: 0; color: #9a6700; font-size: 11px; }
  .output-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--color-border, #e8ebf0); }
  .actions { display: flex; gap: 8px; }
  textarea { display: block; width: 100%; min-height: 380px; padding: 15px; resize: vertical; border: 0; outline: 0; background: var(--color-muted, #fbfcfe); color: var(--color-foreground, #25334a); font: 12px/1.65 "SFMono-Regular", Consolas, monospace; tab-size: 2; }
  textarea::placeholder { color: #9aa5b5; }
  .footnote { margin: 10px 2px 0; color: #7a8698; font-size: 11px; }
  .state { margin-top: 18px; padding: 28px; border: 1px solid var(--color-border, #e4e8ef); border-radius: 10px; background: var(--color-card, var(--color-background, white)); color: var(--color-muted-foreground, #64748b); }
  .error { color: #b42318; }
  .inline-error { margin: 10px 2px; }
  @media (max-width: 560px) { main { padding: 22px 14px; } .selectors { grid-template-columns: 1fr; gap: 12px; } .meta { grid-template-columns: 1fr 1fr; } .rules-grid { grid-template-columns: 1fr; } .output-head { align-items: flex-start; flex-direction: column; } }
</style>
