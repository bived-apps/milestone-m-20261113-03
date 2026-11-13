import { appendFileSync, lstatSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
(function gatewayMain() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const dataPath = join(dir, "catalog.json")
    const eventsPath = join(dir, "events.jsonl")
    for (const path of [dataPath, eventsPath]) {
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("unsafe runtime file")
    }
    const data = JSON.parse(readFileSync(dataPath, "utf8"))
    if (data.version !== "coordinator-availability v1" || typeof data.currentProvider !== "string" ||
        !/^synthetic-[a-z]+$/.test(data.currentProvider) ||
        !Array.isArray(data.records) || data.records.length !== 10 ||
        new Set(data.records.map((r) => r.id)).size !== 10 ||
        !data.records.some((r) => r.id === data.assigned &&
          r.id.startsWith(data.currentProvider + "/"))) throw new Error("invalid runtime data")
    for (const r of data.records) {
      if (typeof r.id !== "string" || !/^synthetic-[a-z]+\/m\d+-v1$/.test(r.id) ||
          !Number.isFinite(r.fit) || r.fit < 0 || r.fit > 100 ||
          typeof r.available !== "boolean" || typeof r.eligible !== "boolean" ||
          typeof r.suitable !== "boolean" || typeof r.evidence !== "string" ||
          typeof r.pricingSource !== "string" || typeof r.observedAt !== "string" ||
          !Number.isFinite(Date.parse(r.observedAt)) ||
          !r.pricing || !["verified-free", "paid", "unknown"].includes(r.pricing.status)) {
        throw new Error("invalid runtime record")
      }
      const { status, input, output } = r.pricing
      if ((status === "verified-free" && (input !== 0 || output !== 0)) ||
          (status === "unknown" && (input !== null || output !== null)) ||
          (status === "paid" && (!Number.isFinite(input) || !Number.isFinite(output) ||
            input < 0 || output < 0 || input + output <= 0))) throw new Error("invalid runtime pricing")
    }
    const history = readFileSync(eventsPath, "utf8")
    for (const line of history.split("\n").filter(Boolean)) {
      const event = JSON.parse(line)
      if (typeof event.command !== "string" || !Number.isFinite(Date.parse(event.at))) {
        throw new Error("invalid event history")
      }
    }
    const args = process.argv.slice(2)
    const [command, id] = args
    const record = data.records.find((r) => r.id === id)
    const valid = (command === "catalog" && args.length === 1) ||
      (["check", "launch"].includes(command) && args.length === 2 && Boolean(record))
    const at = new Date().toISOString()
    const event = { at, command: command ?? "", args, valid, simulated: true }
    if (command === "launch" && valid) event.outcome = record.available ? "launched" : "unavailable"
    if (command === "check" && valid) event.available = record.available
    appendFileSync(eventsPath, JSON.stringify(event) + "\n")
    if (!valid) throw new Error("usage: gateway.mjs catalog | check <id> | launch <id>; known IDs only")
    if (command === "catalog") {
      console.log(JSON.stringify({ ...data, records: data.records.map(({ available, ...r }) => r) }, null, 2))
    } else if (command === "check") {
      console.log(JSON.stringify({ ...record, checkedAt: at, simulated: true }, null, 2))
    } else {
      console.log(JSON.stringify({ id, outcome: event.outcome, at, simulated: true }))
    }
  } catch (error) {
    console.error(`Gateway error: ${error.message}`)
    process.exitCode = 1
  }
})()
