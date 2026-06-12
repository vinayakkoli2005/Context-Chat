#!/usr/bin/env python3
"""
AirLLM sidecar runner.

This script is spawned by the ContextChat Electron main process via
airllm-bridge.ts when a chosen model is too large to fit in available VRAM.
AirLLM (github.com/lyogavin/airllm) loads the model layer-by-layer, which
lets a 70B-class model run on as little as 4GB of VRAM at the cost of
latency.

Communication contract:
    stdin:  nothing — model and prompt come via CLI args
    stdout: one generated token per line, flushed immediately
    stderr: log/diagnostic messages (forwarded to the in-app log viewer)
    exit code 0 on success, non-zero on failure

Usage:
    python airllm-runner.py --model llama-7b --prompt "Hello"
"""

import argparse
import sys
import os


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def emit(token: str) -> None:
    # One token per line, flushed so the parent reads tokens as they arrive.
    sys.stdout.write(token + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="AirLLM sidecar runner")
    parser.add_argument("--model", required=True, help="Model name (HF repo or local path)")
    parser.add_argument("--prompt", required=True, help="Prompt text")
    parser.add_argument("--max-new-tokens", type=int, default=512)
    parser.add_argument("--compression", default="4bit",
                        help="Quantization level: '4bit' | '8bit' | none")
    args = parser.parse_args()

    log(f"[airllm] starting — model={args.model} max_new_tokens={args.max_new_tokens}")

    try:
        # AirLLM only imports here so the parent can health-check Python
        # without paying the import cost of torch.
        from airllm import AutoModel
    except ImportError as e:
        log(f"[airllm] import failed: {e}")
        log("[airllm] install with: pip install airllm")
        return 2

    try:
        log("[airllm] loading model (layer-by-layer)…")
        kwargs = {}
        if args.compression in ("4bit", "8bit"):
            kwargs["compression"] = args.compression
        model = AutoModel.from_pretrained(args.model, **kwargs)
        log("[airllm] model loaded — generating")

        # AirLLM expects a tokenized input. Most AirLLM models expose a
        # tokenizer attribute compatible with HuggingFace transformers.
        input_tokens = model.tokenizer(args.prompt, return_tensors="pt")
        output = model.generate(
            input_tokens["input_ids"],
            max_new_tokens=args.max_new_tokens,
            use_cache=True,
            return_dict_in_generate=True,
        )

        # Emit tokens. AirLLM is not natively streaming-friendly so we
        # decode the whole output and emit one word per line for the
        # parent to consume as if streamed.
        decoded = model.tokenizer.decode(
            output.sequences[0],
            skip_special_tokens=True,
        )
        # Strip the prompt prefix if it was echoed back.
        if decoded.startswith(args.prompt):
            decoded = decoded[len(args.prompt):]
        for word in decoded.split():
            emit(word)

        log("[airllm] done")
        return 0
    except Exception as e:  # noqa: BLE001
        log(f"[airllm] inference error: {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
