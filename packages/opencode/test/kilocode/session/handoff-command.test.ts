// kilocode_change - new file
import path from "path"
import fs from "node:fs/promises"
import { expect } from "bun:test"
import { Effect } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID } from "@/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { reply, TestLLMServer } from "../../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      SessionStatus.node,
      EventV2Bridge.node,
      FSUtil.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)

const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test-model")
const ref = { providerID, modelID }

const setup = Effect.fnUntraced(function* () {
  const llm = yield* TestLLMServer
  const fsys = yield* FSUtil.Service
  const instance = yield* TestInstance
  yield* fsys.writeWithDirs(
    path.join(instance.directory, "opencode.json"),
    JSON.stringify({
      model: "test/test-model",
      small_model: "test/test-model",
      enabled_providers: ["test"],
      formatter: false,
      lsp: false,
      provider: {
        test: {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test-key", baseURL: llm.url },
          models: {
            "test-model": {
              name: "Test Model",
              tool_call: true,
              limit: { context: 100000, output: 10000 },
            },
          },
        },
      },
    }),
  )
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  return { llm, sessions, prompt, instance }
})

// Write a user + assistant exchange directly so the session has history to hand off.
const seed = Effect.fnUntraced(function* (sessionID: MessageV2.User["sessionID"]) {
  const sessions = yield* Session.Service
  const user: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: ref,
  }
  yield* sessions.updateMessage(user)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: user.id,
    sessionID,
    type: "text",
    text: "Build me a thing",
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    sessionID,
    role: "assistant",
    parentID: user.id,
    mode: "build",
    agent: "build",
    path: { cwd: ".", root: "." },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID,
    providerID,
    time: { created: Date.now() },
    finish: "stop",
  }
  yield* sessions.updateMessage(assistant)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "Working on it",
  })
})

it.instance("creates a new session with the kickoff and writes the handoff file", () =>
  Effect.gen(function* () {
    const { llm, sessions, prompt, instance } = yield* setup()
    const session = yield* sessions.create({ title: "Origin session" })
    yield* seed(session.id)

    // First request is the handoff generation; the forked new-session loop is the second.
    yield* llm.push(
      reply()
        .text("---DOCUMENT---\n## Goal\nBuild the thing.\n\n## Progress\nStarted.\n---PROMPT---\nContinue building.")
        .stop(),
    )
    yield* llm.push(reply().text("new session answer").stop())

    const result = yield* prompt.command({
      sessionID: session.id,
      command: "handoff",
      arguments: "",
    })

    // The command returns the kickoff user message, living in a NEW session.
    expect(result.info.role).toBe("user")
    expect(result.info.sessionID).not.toBe(session.id)
    const text = result.parts.find((p): p is MessageV2.TextPart => p.type === "text")
    expect(text?.text).toContain("Continue building.")
    expect(text?.text).toContain("## Goal")

    // The new session holds the kickoff message.
    const nextMsgs = yield* sessions.messages({ sessionID: result.info.sessionID })
    expect(nextMsgs.some((m) => m.info.id === result.info.id)).toBe(true)

    // The handoff document was persisted under .kilo/handoff/.
    const dir = path.join(instance.directory, ".kilo", "handoff")
    const files = yield* Effect.tryPromise(() => fs.readdir(dir)).pipe(Effect.orDie)
    expect(files.length).toBe(1)
    const body = yield* Effect.tryPromise(() => fs.readFile(path.join(dir, files[0]), "utf8")).pipe(Effect.orDie)
    expect(body).toContain("## Goal")
    expect(body).toContain("Build the thing.")
  }),
)

it.instance("fails cleanly when the model does not follow the handoff format", () =>
  Effect.gen(function* () {
    const { llm, sessions, prompt } = yield* setup()
    const session = yield* sessions.create({ title: "Origin session" })
    yield* seed(session.id)

    yield* llm.push(reply().text("no delimiters here").stop())

    const exit = yield* Effect.exit(
      prompt.command({ sessionID: session.id, command: "handoff", arguments: "" }),
    )
    expect(exit._tag).toBe("Failure")

    // No new session beyond the origin one, and no handoff file.
    const all = yield* sessions.list().pipe(Effect.orDie)
    expect(all.filter((s) => s.id !== session.id && !s.parentID)).toHaveLength(0)
  }),
)
