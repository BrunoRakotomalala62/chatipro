#!/bin/bash
MODELS=(
  "gemini-3.1-flash-lite"
  "openai/gpt-5.4-nano"
  "anthropic/claude-3-haiku"
  "deepseek/deepseek-v4-flash"
  "qwen/qwen3.5-flash-02-23"
  "nvidia/nemotron-3-super-120b-a12b"
  "z-ai/glm-4.7-flash"
  "minimax/minimax-m2.7"
  "mistralai/mistral-small-2603"
  "meta-llama/llama-4-maverick"
)
for m in "${MODELS[@]}"; do
  echo "===== MODEL: $m ====="
  curl -s -X POST "https://chati.pro/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -H "verification: taze-app" \
    -H "X-Client: taze-web/ce697ee5d9a6681b9021a595669eb78daef411cc (platform=web)" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"bonjour\"}],\"stream\":false,\"temperature\":0.7,\"path\":\"gemini\",\"model\":\"$m\"}" \
    | head -c 900
  echo ""
done
