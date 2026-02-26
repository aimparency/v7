# Gemini Agent / Watchdog Issue Summary

## Problem Description
The "Animator" (Watchdog) feature in the `wrapped-agents/gemini-session` package is experiencing reliability issues, specifically manifesting as:
1.  **Typing Stalls:** The Watchdog stops typing the prompt into the terminal mid-stream.
2.  **Missing Response Markers:** The Watchdog service fails to find the `PROMPT_MARKER` in the terminal output, leading to "Marker not found" errors.
3.  **Invalid JSON Errors:** Previously, the service would fail to parse JSON because it was reading the entire screen (including banners/prompts) instead of just the response. This was partially addressed but persists if the marker is missed.
4.  **UI Sync Issues:** The frontend terminal for the Watchdog sometimes shows incomplete or no dialogue, even if the backend logs suggest activity.
5.  **Long Delays:** There are significant delays (e.g., ~16s) between the prompt being "sent" and the Watchdog actually processing/responding.

## Observed Behavior & Logs
-   **Prompt Length:** The prepared prompt is consistently large (~2500 chars).
-   **Typing Stoppage:** Typing was observed stopping exactly after a box-drawing character (`\u256f` / `╯`) in the context.
-   **Backend Logs:**
    -   `[WatchdogService] Post complete.` is logged, suggesting the code *thinks* it finished typing.
    -   `[WatchdogService] PROMPT_MARKER not found in last 200 lines. Waiting...` is logged repeatedly (every ~1s) after the post.
    -   `Logic DISABLED` often follows, likely due to user intervention or a timeout/stop signal.
-   **Frontend:** The terminal sometimes shows the prompt cutting off, missing the marker and the subsequent JSON response.
-   **Context:** The context being sent to the Watchdog includes the worker's screen content, which contains ANSI sequences (stripped), newlines, and Unicode box-drawing characters.

## Code State
-   **`watchdog.ts`:**
    -   Uses `node-pty` to spawn `gemini`.
    -   `post` method manually types text in chunks (currently 100 chars, 50ms delay).
    -   `askWatchdog` sends a `/clear` command first, waits 500ms, then sends the main prompt.
    -   The prompt is flattened to a single line (newlines replaced with spaces) to prevent multi-command interpretation.
    -   Context capture is limited to 25 lines / 1000 chars.
    -   Box-drawing characters (`\u2500-\u257F`) are now stripped from the context (latest fix).
    -   `PROMPT_MARKER` is set to `[[RESPONSE_START]]`.
    -   Response parsing requires the marker to be present in the last 200 lines.
    -   `INITIAL_WAIT_AFTER_POST` is set to 3000ms.
-   **`index.ts`:**
    -   Sends last 1000 lines of terminal history to clients on connection.
-   **`agent.ts`:**
    -   PTY cols increased to 120.

## Key Facts
-   The Watchdog is an LLM agent observing another LLM agent (Worker).
-   Communication happens by "typing" prompts into the Watchdog's CLI input.
-   The `gemini` CLI is interactive.
-   The prompt template includes static text, the sanitized worker context, and instructions.
-   The prompt length is dominated by the instructions and the context.

## Actions

-   `send-prompt`: Sends text to the worker. Use `instruct: true` to prepend aimparency guidance.
-   `select-option`: Selects a numbered option.
-   `stop`: Stops the session.
-   `wait`: Waits for a duration.
-   `cooldown`: Waits for a duration (exponential backoff) and optionally performs an action afterwards.
    -   `press`: (Optional) Key to press after cooldown (e.g. "y").
    -   `text`: (Optional) Text to send after cooldown (e.g. "continue").
-   `compress`: Sends `/compress` to the worker to manage context window.
-   `emergency-stop`: Triggered internally on errors.
