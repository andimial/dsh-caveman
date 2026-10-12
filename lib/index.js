// src/index.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// src/constants.ts
var PLUGIN_NAME = "dsh-caveman";
var SECTION_ORDER = 50;
var LEVELS = {
  lite: "\u56DE\u7B54\u8981\u4E13\u4E1A\u7D27\u51D1\uFF1A\u5220\u6389\u586B\u5145\u8BCD\u548C\u4E0D\u786E\u5B9A\u8868\u8FF0\uFF08\u5176\u5B9E\u3001\u5927\u6982\u3001\u53EF\u80FD\uFF09\uFF0C\u4FDD\u7559\u5B8C\u6574\u53E5\u5B50\u7ED3\u6784\uFF0C\u76F4\u63A5\u7ED9\u7ED3\u8BBA\u3002",
  full: "\u50CF\u806A\u660E\u7684\u7A74\u5C45\u4EBA\u4E00\u6837\u6781\u7B80\u56DE\u7B54\uFF1A\u77ED\u53E5\u3001\u788E\u7247\u53E5 OK\uFF0C\u7528\u77ED\u540C\u4E49\u8BCD\u3002\u5220\u6389\u5BA2\u5957\uFF08\u597D\u7684\u3001\u6CA1\u95EE\u9898\uFF09\u3001\u586B\u5145\u8BCD\uFF08\u5176\u5B9E\u3001\u5C31\u662F\u8BF4\uFF09\u3001\u4E0D\u786E\u5B9A\u8868\u8FF0\uFF08\u53EF\u80FD\u3001\u5927\u6982\uFF09\u3002\u4E0D\u94FA\u57AB\uFF0C\u76F4\u63A5\u7ED9\u7ED3\u8BBA\u548C\u4EE3\u7801\u3002\u6280\u672F\u672F\u8BED\u3001\u4EE3\u7801\u3001\u547D\u4EE4\u3001\u9519\u8BEF\u539F\u6587\u4FDD\u7559\uFF0C\u4E00\u4E2A\u5B57\u4E0D\u6539\u3002\u7EDD\u4E0D\u5220\u5426\u5B9A\u8BCD\uFF08\u4E0D/\u6CA1/\u53EA/\u4EC5/\u9664\uFF09\u3002",
  ultra: "\u6781\u81F4\u7CBE\u7B80\uFF1A\u4E00\u8BCD\u591F\u5C31\u4E0D\u4E24\u8BCD\uFF0C\u6BCF\u4E8B\u5B9E\u53EA\u8FF0\u4E00\u6B21\uFF0C\u56E0\u679C\u660E\u786E\u65F6\u5220\u8FDE\u8BCD\u3002\u4E0D\u9020\u7F29\u5199\u3002\u76F4\u63A5\u7ED9\u7ED3\u8BBA\u3002\u6280\u672F\u672F\u8BED\u3001\u4EE3\u7801\u539F\u6587\u4FDD\u7559\u3002\u7EDD\u4E0D\u5220\u5426\u5B9A\u8BCD\u3002",
  "wenyan-full": "\u7528\u6587\u8A00\u6587\u56DE\u7B54\uFF0C\u6700\u5927\u7CBE\u7B80\u3002\u6587\u8A00\u53E5\u5F0F\uFF0C\u52A8\u5BBE\u524D\u7F6E\uFF0C\u4E3B\u8BED\u5E38\u7701\uFF0C\u7528\u6587\u8A00\u865A\u8BCD\uFF08\u4E4B/\u4E43/\u4E3A/\u5176\uFF09\u3002\u6280\u672F\u672F\u8BED\u3001\u4EE3\u7801\u539F\u6587\u4FDD\u7559\u3002"
};
var DEFAULT_LEVEL = "full";

// src/routes.ts
function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === void 0 || host === void 0) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function createWriteGuard(getConnection) {
  return (request, response) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method not allowed; use POST" });
      return false;
    }
    const connection = getConnection();
    if (connection !== void 0) {
      const rejection = connection.requestRejection(request);
      if (rejection !== void 0) {
        sendJson(response, rejection, {
          error: rejection === 401 ? "authentication required" : "untrusted request"
        });
        return false;
      }
      return true;
    }
    if (!sameOrigin(request)) {
      sendJson(response, 403, { error: "untrusted origin" });
      return false;
    }
    return true;
  };
}
function sendJson(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
async function readJsonBody(request, maxBytes = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) return void 0;
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return void 0;
  }
}
function mountCavemanRoutes(ctx, getState, setState) {
  const webServer = ctx.get("webServer");
  if (webServer === void 0) {
    console.error("[dsh-caveman] webServer service absent \u2014 UI routes not mounted");
    return () => {
    };
  }
  const guardWrite = createWriteGuard(() => ctx.get("connection"));
  const disposers = [
    webServer.register({
      kind: "exact",
      path: "/caveman/status",
      handler: (_request, response) => {
        sendJson(response, 200, getState());
      }
    }),
    webServer.register({
      kind: "exact",
      path: "/caveman/state",
      handler: async (request, response) => {
        if (!guardWrite(request, response)) return;
        const body = await readJsonBody(request);
        if (body === void 0 || typeof body !== "object") {
          sendJson(response, 400, { error: "invalid JSON body" });
          return;
        }
        const current = getState();
        const next = {
          enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
          level: typeof body.level === "string" && Object.hasOwn(LEVELS, body.level) ? body.level : current.level
        };
        setState(next);
        sendJson(response, 200, next);
      }
    })
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

// src/index.ts
var name = PLUGIN_NAME;
var inject = ["systemPrompt", "commands"];
var DEFAULT_CONFIG = { enabled: false, level: DEFAULT_LEVEL };
function stateDir() {
  return join(homedir(), ".dsh-caveman");
}
function stateFile() {
  return join(stateDir(), "state.json");
}
function loadState() {
  try {
    if (!existsSync(stateFile())) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(readFileSync(stateFile(), "utf8"));
    const level = parsed.level !== void 0 && Object.hasOwn(LEVELS, parsed.level) ? parsed.level : DEFAULT_LEVEL;
    return { enabled: parsed.enabled === true, level };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveState(state) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(state, null, 2));
  } catch {
  }
}
function apply(ctx) {
  let state = loadState();
  const setState = (next) => {
    state = next;
    saveState(next);
  };
  ctx.effect(function* () {
    yield ctx.systemPrompt.section({
      name: "caveman",
      order: SECTION_ORDER,
      text: () => state.enabled ? LEVELS[state.level] : ""
    });
    yield ctx.commands.register({
      name: "caveman-on",
      description: "\u5F00\u542F\u8F93\u51FA\u7CBE\u7B80\uFF08caveman \u6A21\u5F0F\uFF09",
      handler: async () => {
        setState({ ...state, enabled: true });
        return { kind: "success", text: `\u8F93\u51FA\u7CBE\u7B80\u5DF2\u5F00\u542F\uFF08\u6863\u4F4D ${state.level}\uFF09` };
      }
    });
    yield ctx.commands.register({
      name: "caveman-off",
      description: "\u5173\u95ED\u8F93\u51FA\u7CBE\u7B80",
      handler: async () => {
        setState({ ...state, enabled: false });
        return { kind: "success", text: "\u8F93\u51FA\u7CBE\u7B80\u5DF2\u5173\u95ED" };
      }
    });
    yield ctx.commands.register({
      name: "caveman-level",
      description: "\u5207\u6362\u6863\u4F4D\uFF1Alite / full / ultra / wenyan-full",
      handler: async (invocation) => {
        const raw = String(invocation.rawInput ?? "").trim().toLowerCase();
        if (!Object.hasOwn(LEVELS, raw)) {
          return { kind: "error", text: `\u672A\u77E5\u6863\u4F4D\u300C${raw}\u300D\uFF0C\u53EF\u9009\uFF1A${Object.keys(LEVELS).join(" / ")}` };
        }
        setState({ ...state, level: raw, enabled: true });
        return { kind: "success", text: `\u6863\u4F4D\u5DF2\u5207\u5230 ${raw}` };
      }
    });
    yield ctx.commands.register({
      name: "caveman-status",
      description: "\u67E5\u770B\u8F93\u51FA\u7CBE\u7B80\u72B6\u6001",
      handler: async () => {
        return {
          kind: "success",
          text: state.enabled ? `\u8F93\u51FA\u7CBE\u7B80\uFF1A\u5F00\u542F\uFF08\u6863\u4F4D ${state.level}\uFF09` : "\u8F93\u51FA\u7CBE\u7B80\uFF1A\u5173\u95ED"
        };
      }
    });
  }, "dsh-caveman lifecycle");
  ctx.inject(["webServer"], (scoped) => {
    scoped.effect(() => mountCavemanRoutes(
      scoped,
      () => state,
      (next) => setState(next)
    ), "dsh-caveman ui routes");
  });
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
