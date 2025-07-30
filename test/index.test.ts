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
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1/commits")
      .reply(200, mockCommits)

      // Test that a warning comment is posted
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
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

      // Mock the commits list API call (called twice - once for conventional commits, once for PR labeling)
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1/commits")
      .reply(200, mockCommits)
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1/commits")
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
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1/commits")
      .reply(200, mockCommits)

      // Test that a warning comment is posted
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
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
      .get("/repos/donkeylover/donkey-ops-testing/contents/.donkeyops.yml")
      .query(true)
      .reply(200, {
        content: configYaml,
        encoding: "base64"
      })
      // Mock the commits list API call
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1/commits")
      .reply(200, mockCommits)
      // Test that a warning comment is posted for the invalid commits
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
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

  test("automatically labels PR based on title keywords", async () => {
    const mockCommits = [
      {
        sha: "abc1234",
        commit: {
          message: "feat(Core & Internals): add new feature #42"
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
      // Mock the commits list API call
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1/commits")
      .reply(200, mockCommits)
      // Mock getting current labels (empty)
      .get("/repos/donkeylover/donkey-ops-testing/issues/1/labels")
      .reply(200, [])
      // Mock adding labels
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/labels", (body: any) => {
        expect(body.labels).toContain("Core & Internals");
        return true;
      })
      .reply(200);

    // Create a payload with a PR title that contains component keywords
    const prPayload = {
      ...pullRequestPayload,
      pull_request: {
        ...pullRequestPayload.pull_request,
        title: "feat: Add new Core & Internals feature"
      }
    };

    // Receive a webhook event
    await probot.receive({ name: "pull_request", payload: prPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("labels PR from commits when title has no valid components", async () => {
    const mockCommits = [
      {
        sha: "abc1234",
        commit: {
          message: "feat(Core): add new feature #42"
        }
      },
      {
        sha: "def5678",
        commit: {
          message: "fix(Testing): add unit tests #123"
        }
      },
      {
        sha: "bad0000",
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
      // Mock the commits list API call (for both commit validation and PR labeling)
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1/commits")
      .reply(200, mockCommits)
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1/commits")
      .reply(200, mockCommits)
      // Mock getting current labels (empty)
      .get("/repos/donkeylover/donkey-ops-testing/issues/1/labels")
      .reply(200, [])
      // Mock adding labels
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/labels", (body: any) => {
        expect(body.labels).toContain("Core");
        expect(body.labels).toContain("Testing");
        return true;
      })
      .reply(200);

    // Create a payload with a PR title that has no component keywords
    const prPayload = {
      ...pullRequestPayload,
      pull_request: {
        ...pullRequestPayload.pull_request,
        title: "feat: Add new functionality"
      }
    };

    // Receive a webhook event
    await probot.receive({ name: "pull_request", payload: prPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops label command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops label Core"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/labels", (body: any) => {
        expect(body.labels).toContain("Core");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops unlabel command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops unlabel Core"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .delete("/repos/donkeylover/donkey-ops-testing/issues/1/labels/Core")
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops close command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops close"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .patch("/repos/donkeylover/donkey-ops-testing/issues/1", (body: any) => {
        expect(body.state).toBe("closed");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops assign command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops assign username"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/assignees", (body: any) => {
        expect(body.assignees).toContain("username");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops approve command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops approve"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "write",
        },
      })
      .post("/repos/donkeylover/donkey-ops-testing/pulls/1/reviews", (body: any) => {
        expect(body.event).toBe("APPROVE");
        expect(body.body).toBe("Approved via /donkeyops approve command");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles unknown slash command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops unknown"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
        expect(body.body).toContain("❌ **Unknown command:** `unknown`");
        expect(body.body).toContain("Available commands:");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops unassign command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops unassign username"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .delete("/repos/donkeylover/donkey-ops-testing/issues/1/assignees", (body: any) => {
        expect(body.assignees).toContain("username");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops review command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops review"
      },
      pull_request: {
        number: 1,
        title: "Test PR"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mockDiff = `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { Probot } from "probot";
+import fetch from "node-fetch";
 
 // Default valid types for conventional commits`;

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "read",
        },
      })
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1")
      .reply(200, {
        number: 1,
        title: "Test PR",
        head: { sha: "abc123" },
        base: { sha: "def456" }
      })
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1")
      .matchHeader('accept', 'application/vnd.github.v3.diff')
      .reply(200, mockDiff)
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
        expect(body.body).toContain("🤖 Code Review by DonkeyOps Bot");
        return true;
      })
      .reply(200);

    // Mock the Codellama API call
    nock("http://localhost:11434")
      .post("/api/generate", (body: any) => {
        expect(body.model).toBe("qwen2.5-coder");
        expect(body.prompt).toContain("Test PR");
        expect(body.prompt).toContain("diff --git");
        return true;
      })
      .reply(200, {
        model: "qwen2.5-coder",
        response: "Code looks good. No issues found.",
        done: true
      });

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops review command on issue (not PR)", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops review"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
        expect(body.body).toContain("❌ **Error:** Code review is only available for pull requests, not issues.");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops summary command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops summary"
      },
      pull_request: {
        number: 1,
        title: "Test PR"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mockDiff = `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { Probot } from "probot";
+import fetch from "node-fetch";
 
 // Default valid types for conventional commits`;

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "read",
        },
      })
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1")
      .reply(200, {
        number: 1,
        title: "Test PR",
        head: { sha: "abc123" },
        base: { sha: "def456" }
      })
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1")
      .matchHeader('accept', 'application/vnd.github.v3.diff')
      .reply(200, mockDiff)
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
        expect(body.body).toContain("📋 PR Summary");
        return true;
      })
      .reply(200);

    // Mock the Qwen2.5-coder API call
    nock("http://localhost:11434")
      .post("/api/generate", (body: any) => {
        expect(body.model).toBe("qwen2.5-coder");
        expect(body.prompt).toContain("Test PR");
        expect(body.prompt).toContain("diff --git");
        return true;
      })
      .reply(200, {
        model: "qwen2.5-coder",
        response: "Added node-fetch import to src/index.ts",
        done: true
      });

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops summary command on issue (not PR)", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops summary"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
        expect(body.body).toContain("❌ **Error:** PR summary is only available for pull requests, not issues.");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops ask command", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops ask What files were changed?"
      },
      pull_request: {
        number: 1,
        title: "Test PR"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mockDiff = `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { Probot } from "probot";
+import fetch from "node-fetch";
 
 // Default valid types for conventional commits`;

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "read",
        },
      })
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1")
      .reply(200, {
        number: 1,
        title: "Test PR",
        head: { sha: "abc123" },
        base: { sha: "def456" }
      })
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1")
      .matchHeader('accept', 'application/vnd.github.v3.diff')
      .reply(200, mockDiff)
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
        expect(body.body).toContain("🤔 Question about PR Changes");
        expect(body.body).toContain("What files were changed?");
        return true;
      })
      .reply(200);

    // Mock the Qwen2.5-coder API call
    nock("http://localhost:11434")
      .post("/api/generate", (body: any) => {
        expect(body.model).toBe("qwen2.5-coder");
        expect(body.prompt).toContain("What files were changed?");
        expect(body.prompt).toContain("diff --git");
        return true;
      })
      .reply(200, {
        model: "qwen2.5-coder",
        response: "The src/index.ts file was changed to add a node-fetch import.",
        done: true
      });

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops ask command without question", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops ask"
      },
      pull_request: {
        number: 1,
        title: "Test PR"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
          pulls: "read",
        },
      })
      .get("/repos/donkeylover/donkey-ops-testing/pulls/1")
      .reply(200, {
        number: 1,
        title: "Test PR",
        head: { sha: "abc123" },
        base: { sha: "def456" }
      })
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
        expect(body.body).toContain("❌ **Error:** Please provide a question");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("handles /donkeyops ask command on issue (not PR)", async () => {
    const commentPayload = {
      action: "created",
      issue: {
        number: 1,
        body: "/donkeyops ask What changed?"
      },
      repository: {
        name: "donkey-ops-testing",
        owner: {
          login: "donkeylover"
        }
      },
      installation: {
        id: 2
      }
    };

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })
      .post("/repos/donkeylover/donkey-ops-testing/issues/1/comments", (body: any) => {
        expect(body.body).toContain("❌ **Error:** Asking questions about changes is only available for pull requests, not issues.");
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issue_comment", payload: commentPayload });

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
