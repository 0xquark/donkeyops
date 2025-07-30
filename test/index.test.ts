// You can import your modules
// import index from '../src/index'

import nock from "nock";
// Requiring our app implementation
import myProbotApp from "../src/index.js";
import { Probot, ProbotOctokit } from "probot";
// Requiring our fixtures
//import payload from "./fixtures/issues.opened.json" with { "type": "json"};
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, beforeEach, afterEach, test, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8",
);

const pullRequestPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/pull_request.opened.json"), "utf-8"),
);

describe("My Probot app", () => {
  let probot: any;

  beforeEach(() => {
    nock.disableNetConnect();
    probot = new Probot({
      appId: 123,
      privateKey,
      // disable request throttling and retries for testing
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
    // Load our app into probot
    probot.load(myProbotApp);
  });

  test("creates a warning comment when PR has invalid conventional commits", async () => {
    const mockCommits = [
      {
        sha: "abc1234",
        commit: {
          message: "invalid commit message"
        }
      },
      {
        sha: "def5678",
        commit: {
          message: "feat(Core & Internals): fix bug #123"
        }
      }
    ];

    const mock = nock("https://api.github.com")
      // Test that we correctly return a test token
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "read",
        },
      })

      // Mock the commits list API call
      .get("/repos/hiimbex/testing-things/pulls/1/commits")
      .reply(200, mockCommits)

      // Test that a warning comment is posted
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body: any) => {
        expect(body.body).toContain("Conventional Commit Check");
        expect(body.body).toContain("Found 1 commit(s) that don't follow the conventional commit format");
        expect(body.body).toContain("invalid commit message");
        expect(body.body).toContain("Conventional Commit Warning");
        return true;
      })
      .reply(200);

    // Receive a webhook event
    await probot.receive({ name: "pull_request", payload: pullRequestPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("does not create a comment when PR has all valid conventional commits", async () => {
    const mockCommits = [
      {
        sha: "abc1234",
        commit: {
          message: "feat(Core & Internals): fix bug #123"
        }
      },
      {
        sha: "def5678",
        commit: {
          message: "test(Testing): add unit tests #456"
        }
      }
    ];

    const mock = nock("https://api.github.com")
      // Test that we correctly return a test token
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "read",
        },
      })

      // Mock the commits list API call
      .get("/repos/hiimbex/testing-things/pulls/1/commits")
      .reply(200, mockCommits);

    // Receive a webhook event
    await probot.receive({ name: "pull_request", payload: pullRequestPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("creates a warning for invalid component in conventional commit", async () => {
    const mockCommits = [
      {
        sha: "abc1234",
        commit: {
          message: "feat(InvalidComponent): fix bug #123"
        }
      }
    ];

    const mock = nock("https://api.github.com")
      // Test that we correctly return a test token
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "read",
        },
      })

      // Mock the commits list API call
      .get("/repos/hiimbex/testing-things/pulls/1/commits")
      .reply(200, mockCommits)

      // Test that a warning comment is posted
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body: any) => {
        expect(body.body).toContain("Invalid Component Warning");
        expect(body.body).toContain("InvalidComponent");
        expect(body.body).toContain("Valid components:");
        return true;
      })
      .reply(200);

    // Receive a webhook event
    await probot.receive({ name: "pull_request", payload: pullRequestPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("uses repo-specific config from .donkeyops.yml for valid types and components", async () => {
    // Mock .donkeyops.yml content (base64 encoded)
    const configYaml = Buffer.from(
      `conventional_commits:\n  type_enum:\n    - custom\n    - fix\n  valid_components:\n    - CustomComponent\n    - Core\n  commit_format: \"<type>(<component>): <short_message> #<issue_number>\"\n  enabled: true\n`
    ).toString("base64");

    const mockCommits = [
      {
        sha: "abc1234",
        commit: {
          message: "custom(CustomComponent): something cool #42"
        }
      },
      {
        sha: "def5678",
        commit: {
          message: "fix(Core): bug fix #123"
        }
      },
      {
        sha: "bad0000",
        commit: {
          message: "feat(Core): not allowed type #999"
        }
      },
      {
        sha: "bad1111",
        commit: {
          message: "custom(Unknown): not allowed component #888"
        }
      },
      {
        sha: "bad2222",
        commit: {
          message: "invalid commit message"
        }
      }
    ];

    const mock = nock("https://api.github.com")
      // Test that we correctly return a test token
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "read",
          contents: "read"
        },
      })
      // Mock the config file fetch
      .get("/repos/hiimbex/testing-things/contents/.donkeyops.yml")
      .query(true)
      .reply(200, {
        content: configYaml,
        encoding: "base64"
      })
      // Mock the commits list API call
      .get("/repos/hiimbex/testing-things/pulls/1/commits")
      .reply(200, mockCommits)
      // Test that a warning comment is posted for the invalid commits
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body: any) => {
        expect(body.body).toContain("Conventional Commit Check");
        expect(body.body).toContain("Found 3 commit(s) that don't follow the conventional commit format");
        expect(body.body).toContain("feat(Core): not allowed type #999"); // invalid type
        expect(body.body).toContain("custom(Unknown): not allowed component #888"); // invalid component
        expect(body.body).toContain("invalid commit message"); // invalid format
        expect(body.body).toContain("Invalid Type Warning");
        expect(body.body).toContain("Invalid Component Warning");
        expect(body.body).toContain("Conventional Commit Warning");
        return true;
      })
      .reply(200);

    // Receive a webhook event
    await probot.receive({ name: "pull_request", payload: pullRequestPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});

// For more information about testing with Jest see:
// https://facebook.github.io/jest/

// For more information about using TypeScript in your tests, Jest recommends:
// https://github.com/kulshekhar/ts-jest

// For more information about testing with Nock see:
// https://github.com/nock/nock
