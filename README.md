# Auth Service
This is an example implementation of a REST API that registers users by 
username and password and verifies login attempts, enforcing password complexity
requirements and throttling to protect against brute-force attacks

## Getting Started

Prerequisites:
- Docker/docker-compose CLI

From the project directory, run:
```bash
docker-compose up
```
This will stand up the auth service on port 3000 (exposed on your local machine) with a redis instance configured to persist
data to a volume. 

```shell
curl http://localhost:3000/health
```
```json
{"status":"ok"}
```

## Endpoints
All requests and responses are JSON, with status codes and expected HTTP methods following RESTful conventions.
All errors share a standard schema - see [Error Messages](#error-messages) for a table of all error codes.

### POST /api/v1/users
Creates a new user with the supplied username and password.

Usernames are 3-32 characters matching `^[a-z0-9][a-z0-9._-]{2,31}$`. Passwords
must clear the complexity policy (see [Features and Tuning](#features-and-tuning)).

#### Request body
```json
{
  "username": "foo",
  "password": "mysecretpassword12345!"
}
```
*Example `curl` usage*:
```shell
curl -X POST http://localhost:3000/api/v1/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"foo","password":"mysecretpassword12345!"}'
```
*NOTE: Using `read -s` to avoid storing passwords in your shell history is highly recommended
in real production scenarios*

#### Response
*Success: HTTP 201* (with a `Location: /api/v1/users/foo` header)
```json
{
  "username": "foo"
}
```

*Failure when user already exists: HTTP 409*
```json
{
  "error": { "code": "username_taken", "message": "username is already taken" }
}
```

*Failure when password complexity requirements aren't met: HTTP 400*
```json
{
  "error": { "code": "password_too_short", "message": "password must be at least 15 characters, got 6" }
}
```

### GET /api/v1/users/\<username\>
Authenticates the user, i.e. checks that the supplied password is correct for the username.
#### Request headers
*Username and password MUST be provided as a Basic Authentication header*
```http request
Authorization: Basic ...
```
*Example `curl` usage*:
```shell
curl -u foo:mysecretpassword12345! http://localhost:3000/api/v1/users/foo
```

#### Response
##### Success: HTTP 200
```json
{
  "username": "foo"
}
```

##### Missing user OR incorrect password: HTTP 401
Unknown-user and wrong-password responses are byte-for-byte identical, so the endpoint cannot be used to tell which usernames exist.
```http request
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="auth", charset="UTF-8"

{
  "error": {
    "code": "invalid_credentials",
    "message": "invalid credentials"
  }
}
```

##### Missing or malformed Basic auth header: HTTP 401
```http request
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="auth", charset="UTF-8"

{
  "error": {
    "code": "unauthorized",
    "message": "authentication required"
  }
}
```

##### Basic-auth username does not match the path username: HTTP 400
```json
{
  "error": {
    "code": "username_mismatch",
    "message": "credentials do not match the requested user"
  }
}
```

##### Too many failed attempts: HTTP 429
Returned once too many attempts have been made to authentica a username. See the throttle row in [Features and Tuning](#features-and-tuning).
```http request
HTTP/1.1 429 Too Many Requests
Retry-After: 900

{
  "error": {
    "code": "rate_limited",
    "message": "too many failed attempts, try again later"
  }
}
```

## Error Messages
Every failure returns the same envelope:
```json
{
  "error": {
    "code": "<machine-readable code>",
    "message": "<human-readable explanation>"
  }
}
```
The `code` is meant to be stable and safe to use in downstream consumet logic; the `message` is human-facing and may changed/localized.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `validation_error` | 400 | Request body or path failed schema validation (missing field, bad username pattern, unknown property). |
| `username_too_short` | 400 | Username shorter than the 3-character minimum. |
| `password_too_short` | 400 | Password under the 15-code-point floor. |
| `password_too_long` | 400 | Password over the 512-code-point ceiling. |
| `password_all_one_char` | 400 | Password is a single character repeated. |
| `password_repeated_block` | 400 | Password is a short block repeated to length. |
| `password_sequence` | 400 | Password is a character sequence or keyboard walk. |
| `password_contains_username` | 400 | Password contains the username. |
| `password_contains_service_name` | 400 | Password contains this service's own name. |
| `password_common` | 400 | Password is on the common-password blocklist. |
| `username_mismatch` | 400 | Basic-auth username does not match the path username. |
| `bad_request` | 400 | Request body is empty or not valid JSON. |
| `unauthorized` | 401 | Missing or malformed Basic auth header. |
| `invalid_credentials` | 401 | Unknown user or incorrect password (indistinguishable by design). |
| `method_not_allowed` | 405 | Path exists but not for this method; response carries an `Allow` header. |
| `username_taken` | 409 | A user with that username already exists. |
| `payload_too_large` | 413 | Request body exceeds the 16 KiB limit. |
| `unsupported_media_type` | 415 | Request content type is not `application/json`. |
| `rate_limited` | 429 | Too many failed login attempts; response carries `Retry-After`. |
| `internal_error` | 500 | Unexpected server error; details are logged, never returned to the caller. |
| `unhealthy` | 503 | `/health` dependency check (Redis ping) failed. |

## Features and Tuning
| Feature                          | Details                                                                                                                                                  | Name of Standard                                                                                                 | How to Adjust                                                                                                                                                                                       |
|----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Password hashing with Argon2id   | Argon2id (m=19456 KiB, t=2, p=1, 16-byte salt)                                                                                                           | OWASP Password Storage Cheat Sheet, "Argon2id" section                                                                                  | `MEMORY_KIB` / `PASSES` / `PARALLELISM` in `src/app/auth/crypto.ts`. Verify reads the parameters back from each stored hash, so raising the cost still validates hashes written under the old cost. |
| Password length                  | 15-512 code points, counted after NFC normalization                                                                                                      | NIST SP 800-63B-4 §3.1.1.2 (Password Verifiers)                                                                                                  | `PASSWORD_MIN_CODE_POINTS` / `PASSWORD_MAX_CODE_POINTS` in `src/app/auth/password-policy.ts`.                                                                                                       |
| Password blocklist and structure | Screens known-bad, repeated, and sequential passwords, as well as password containing the username                                                       | NIST SP 800-63B-4 §3.1.1.2; structural screens per Rev 3 §5.1.1.2                                                                                                  | `RESIDUAL_BLOCKLIST`, `WALK_ALPHABETS`, `SERVICE_NAME_VARIANTS` in `src/app/auth/password-policy.ts`.                                                                                               |
| Unicode password normalization   | Passwords are NFC-normalized before measuring and hashing, so canonically equivalent inputs (e.g. composed vs decomposed accents) verify identically   | Unicode UAX #15 §12.1; NIST SP 800-63B-4 §3.1.1.2                                                                                 | `normalizePassword` in `src/app/auth/password-policy.ts`; registration and login both pass through it.                                                                                              |
| Username format                  | 3-32 chars, first alphanumeric                                                                                                                           | POSIX portable-username subset                                                                                   | `USERNAME_PATTERN` in `src/app/auth/plugin.ts`; `USERNAME_MIN_CODE_POINTS` in `src/app/auth/password-policy.ts`.                                                                                    |
| Failed-login throttle            | 10 failures / 900 s fixed window, per username                                                                                                           | NIST SP 800-63B-4 §3.2.2, Rate Limiting (Throttling)                                                                                    | `THROTTLE_MAX_FAILURES` / `THROTTLE_WINDOW_SECONDS` in `src/app/auth/throttle.ts`.                                                                                                                  |
| Anti-enumeration authentication  | Unknown-user and wrong-password attempts each cost one Argon2id hash and return byte-identical 401s; the throttle counts attempts whether or not the user exists | OWASP Authentication Cheat Sheet, "Authentication Responses"                                                   | Fixed by design; the equal-cost path lives in the GET handler in `src/app/auth/plugin.ts`.                                                                                                          |
| Response cache suppression       | `Cache-Control: no-store` and `Pragma: no-cache` on every authentication response, so no cache ever stores a credential-check outcome                    | HTTP caching, RFC 9111                                                                                           | Fixed by design; `onSend` hook on the GET route in `src/app/auth/plugin.ts`.                                                                                                                        |
| Login credential serialization   | Username and password sent in the `Authorization: Basic` header                                                                                          | Basic authentication, RFC 7617                                                                                   | Fixed by the spec; parsing and challenge live in `src/app/auth/basic-auth.ts`.                                                                                                                      |
| Request body limit               | 16 KiB cap, rejected before parsing                                                                                                                      | -                                                                                                                | `MAX_BODY_BYTES` in `src/app/index.ts`.                                                                                                                                                             |
| Redis configuration              | `--appendonly` to persist every Redis write, `--maxmemory-policy noeviction` to fail when Redis capacity exceeded instead of evicting user registrations | -                                                                                                                | `REDIS_URL` environment variable, `docker-compose.yml` for redis-server flags                                                                                                                       |
| libuv threadpool sizing          | Argon2id hashing runs on Node's libuv threadpool (4 threads by default), which caps concurrent hashes per process.  | -                                                                                                                | `UV_THREADPOOL_SIZE` environment variable (see `.env.example`). Tune to number of vCPUs in production                                                                         |

Standards and sources referenced above:
- [NIST SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html) (Rev 4, Aug 2025): §3.1.1.2 Password Verifiers, §3.2.2 Rate Limiting (Throttling)
- [NIST SP 800-63B Rev 3](https://pages.nist.gov/800-63-3/sp800-63b.html): §5.1.1.2, cited for the "repetitive or sequential characters" screening examples that Rev 4 no longer enumerates
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): "Argon2id" under Password Hashing Algorithms
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): "Authentication Responses" and "Protect Against Automated Attacks"
- [Unicode Standard Annex #15, Unicode Normalization Forms](https://www.unicode.org/reports/tr15/): defines NFC (§12.1)
- [SecLists, xato-net-10-million-passwords-100000.txt](https://github.com/danielmiessler/SecLists/blob/c205c36a445bff37f8e58a9ec829105cd4975c58/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt): source corpus for the residual blocklist, filtered to entries of 15+ characters, lowercased and deduplicated (70 entries)


## Limitations
It's important to note that this service is not fully compliant with NIST SP 800-63, even though it follows
certain guidelines outlined in the standard (see table above). 

### No permanent account lock-out

NIST SP 800-63B-4 §3.2.2 requires that we essentially disable/lock a user account after a certain maximum number (no more than 100)
of failed login attempts. This feature was not implemented in this project. It could be implemented by storing 
a key like `lockout:<username>` in Redis. Additional consideration would need to be made regarding:
- what happens when a new user registers under a name that's locked out
- whether a mechanism to unlock an account should be implemented

### Passwords aren't checked against common/breached password databases

OWASP Authentication Cheat Sheet recommends https://haveibeenpwned.com/ API to check that a new/existing user's password
is not reported as compromised. This project did not integrate the API due to time constraints. Having a dependency on a third-party
API would also be detrimental to performance (one of the goals of the project). As well, it will restrict ability to deploy our
auth service in an air-gapped environment (which could be a reasonable requirement for an internal auth service).

Instead, this project opted to use a subset of a SecLists password list referred to by the OWASP Cheat Sheet. This
is mainly to illustrate the motivation - a real implementation should at least provide a mechanism to regularly pull
from an updated version of that list, or, even better, support externally and/or self-hosted "Have I Been Pwned" password database(s).


### docker-compose demo does not use TLS

OWASP Authentication Cheat Sheet's examples are public-facing web app scenarios. However, even for an internal 
auth service deployed in a private VPC, TLS should still be considered best practice. An attacker who compromises 
a host on the same VPC could either eavesdrop on unencrypted traffic to/from the auth service containing live user credentials,
as well as impresonate the auth service to obtain credentials or to allow unauthorized access.

However, in the interest of time, demonstrating TLS deployment is outside the scope of this demo.


### No password strength guidance

OWASP Authentication Cheat Sheet recommends including "a password strength meter to help users create a more complex password".
This is assumed to be the responsibility of the upstream service that uses this authentication service. Our error messages return
limited information about why a password doesn't pass validation when registering.


### Registration endpoint is an enumeration attack vector

Duplicate username registrations should not be allowed, so the endpoint has no choice
but to refuse registration for a username that already exists. An attacker could check whether
a username exists by simply attempting to register a new user with that name.

The upstream service that uses this auth service should be responsible for gating/throttling
access to POST /api/v1/users (e.g. by requiring a phone number/email confirmation out-of-band etc).

Only the authentication (GET) endpoint is resistant to enumeration attacks.

## Design Decisions &amp; Rationale

### Minimal Dependencies and no lifecycle hooks
This project tries to minimize 3rd-party library use as much as possible, preferring native
Node functionality where possible. This decision motivates many other design decisions below.

Pros: 
- Decreased chance of supply-chain vulnerabilities. Incidences of malware in third-party npm packages
seem to be on the rise, as well as the ease with which AI-powered tools help discover vulnerabilities. Reducing
dependencies to reduce attack surface makes more sense for an authentication service.

Cons:
- Having to re-implement a small amount of boilerplate (e.g. our data-store plugin is arguably similar to fastify-redis)
- Node's native code coverage does not detect certain branches of ternary statements not being covered (a third-party library might have caught it)
- We should stay away from module mocks as a testing strategy because that's an experimental/unstable feature in Node.js. A third-party library would have made testing easier.

### TypeScript at runtime with Node's built-in TS support
TypeScript in general is a good choice to catch bugs before runtime (e.g. forgotten/mistyped field names, wrong arguments passed to functions etc).
This project chooses to use Node's built-in TS support instead of transpilation and to use
`tsc --noEmit` for typechecking (as Node's built-in support does not typecheck - it just ignores the types).

Pros:
- No extra dependencies to support TS
- No extra build steps - what runs in production is what you see in the IDE. No bugs related to discrepancy between 
sources and the otherwise-transpiled build.

Cons:
- `tsc --noEmit` is a conscious extra step that should be run to detect the bugs TS protects us from. 
  - CI includes this step and fails builds that fail typecheck. 
- No support for frameworks that rely on TS type metadata baked into transpiled code (e.g. NestJS dependency injection - 
but at the same time, introducing this complexity would go against keeping this service lean and more maintainable)


### Node >= 24.7.0
- Node 24.7.0 introduced Argon2 hashing algorithm. To minimize dependencies, it's better to
use a newer (arguable more security-patched) Node with built-in support than a third-party package.
- 

**REMAINDER OF THIS SECTION TO BE CONTINUED...**

## AI Usage Disclosure

I've chosen to use Claude Code cli running on Fable 5/Opus 4.8 at xhigh effort level (via my 20x Max individual subscription),
as part of the following workflow:

### Phase 1: Architecture Planning
I've briefed my AI agent on the overall goal of the project and I started to tell it how I'd implement it to get
its reaction. The goal was to discover blind spots in my design and to "instantiate" my design with concrete frameworks
and configuration decisions.

Throughout the process, I asked it to maintain a ["decision log"](docs/DECISIONS.md) - a file where it would put every major decision
that I commit to. While the decisions/ideas themselves were mine, that log was written by the agent - in part for 
convenience, but also to maximize its utility to the agent in the next phase (i.e. I assumed it knew better how to phrase
things in a way that would be read back with more precision later). That log is committed in this repo as
[docs/DECISIONS.md](docs/DECISIONS.md), lightly edited for publication.

For example, at first I described why I would not implement token issuance or session maintenance for an internal auth 
service, and similar high-level/"product-level" decisions.

Then, I delved into areas like:
- which standards are out there (e.g. NIST, OWASP guidelines, etc), and how I can implement them in a practical way
- which exact hashing alogrithm to use (I knew bcrypt from before, but this time I've discovered that standards got
updated to recommend argon)
- concrete choice of framework (e.g. Express is too low-level - more bug surface to maintain, Nest is too over-engineered 
for an API of two endpoints, etc) and the stance on third-party dependencies in a security-sensitive context (i.e.
avoid dependendencies and keep the app simple as a defensive posture, of sorts; no third-party dependencies for crypto, 
because that's the secure core of our solution - trusting Node.js built-in support more than anything from npm)
- maximal practical adherence to REST (e.g. most examples of auth I've seen do a POST to login - I deliberately
broke that tradition with my GET+Basic Auth approach in exchange for looking more RESTful)
- testing strategies


### Phase 2: Implementation
I would describe which "layer" of the solution would be implemented at the start of each separate session in this phase.
Each session would branch off a compacted conversation from Phase 1, separately including the decision log into the context window
before the start of the implementation session. At the end of every session, I'd branch a new conversation, ask it to summarize
everything from the (compacted) end of Phase 1, and then the next session would continue from a context that included 
compacted Phase 1 and a series of summaries of the Phase 2 layers implemented so far. I believe this allowed the agent
to have maximum awareness of how the project is evolving, while attempting not to run out of practical context window limit.

I'd put the agent into plan mode, ask it to ask question and present a plan for my review. After iterating on the plan and
approving it, I'd let the agent work. Then, I'd ask the agent to self-review its own changes. After that, I'd do manual
review through Pycharm and tweak things/ask questions and taken notes for certain changes/decisions I'd want to work on after Phase 2.

### Phase 3: End-to-end Manual Review
Once we were code-complete, I reviewed the entire codebase, challenging decisions and implementation details - 
I'd ask the agent why something was implemented in a particular way, sometimes propose alternatives, ask about pros and cons,
and make modifications.

Examples of larger corrections included:
- Abandoned the dependency-injection pattern built into the project, which was over-engineering for the scope we have
- Adopted Fastify-idiomatic plugin pattern to make the project structure a bit more recognizable to a reader who worked with 
Fastify before
- Identified and fixed a TOCTTOU issue with our throttling logic
- Configured Redis to flush every update to disk, deciding that I'd "buy" confidence that every user registration
is persisted at the tradeoff of disk I/O and performance on the Redis side, at scale.


### Which parts of this project have been executed by me (the human)
- Bugfixes and certain refactors
- All ideas, decisions, and system design
- Scaffolding for many things, and for the documentation
- Manual verification of referenced documentation and standards. In particular, I tried to manually verify the NIST and OWASP standards 
the agent referenced in its implementation, by opening relevant links myself, reading the standards and reading the 
code and documentation.
- Limitations, Design Decisions & Rationale, and this AI Usage Disclosure Section
- Manual code review. I've spend more time reading/reviewing/correcting than writing net-new code.

### Which parts of this project have been written by AI?
- Most of the code
- All of the test code
- Most of this README (i.e. the repetitive pieces like enumerating error codes, responses etc)

### What I would have done differently if I had to do this again

- Protect the decision log from the agent's edits after Phase 1. Closer to the end of the project, the decision log
started to be more "spammy", containing smaller-scoped decisions, overshadowing the larger, more important ones from earlier
- Scaffold the project myself by hand a bit more before letting the agent go on to Phase 2. The refactor to get rid of 
unnecessary DI could have been avoided
- Make each "layer" of Phase 2 scoped a bit more precisely - i.e. more sessions/iterations, each session with smaller scope of work.
- My own AI agent suggested we should have parallelized the layers/implementation sessions. I might consider that, 
but I'm not completely sure, because 
the deliberate pace and sequencing, while slow, helped me stay focused, which, I would argue, is sometimes more important than
speed when implementing something security-related, like an auth service (albeit within reason). The need for that tradeoff
is a matter of taste and it depends on the amount of review bandwidth I (as a human developer) might have on any given day.

