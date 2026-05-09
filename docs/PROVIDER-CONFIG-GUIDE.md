# Goose Provider Configuration Guide

This document lists all supported providers in Goose, their provider IDs, and required environment variables.

## Important: Provider ID vs Display Name

**You must use the `provider_id` (not the display name) when switching providers via ACP.**

The provider ID is defined in each provider's configuration file as the `name` field.

---

## Provider IDs and API Keys

### Built-in Providers (from Rust code)

| Provider | Provider ID | API Key Env Variable | Notes |
|----------|-------------|---------------------|-------|
| xAI (Grok) | `xai` | `XAI_API_KEY` | Built-in provider |
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY` | Built-in provider |
| OpenAI | `openai` | `OPENAI_API_KEY` | Optional key for openai.com |
| Google (Gemini) | `google` | `GOOGLE_API_KEY` | Built-in provider |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | Built-in provider |

### Declared Providers (from JSON files)

| Provider ID | API Key Env Variable | Display Name |
|-------------|---------------------|--------------|
| `custom_deepseek` | `DEEPSEEK_API_KEY` | DeepSeek |
| `groq` | `GROQ_API_KEY` | Groq |
| `cerebras` | `CEREBRAS_API_KEY` | Cerebras |
| `mistral` | `MISTRAL_API_KEY` | Mistral |
| `moonshot` | `MOONSHOT_API_KEY` | Moonshot (Kimi) |
| `minimax` | `MINIMAX_API_KEY` | MiniMax |
| `novita` | `NOVITA_API_KEY` | Novita |
| `nvidia` | `NVIDIA_API_KEY` | NVIDIA |
| `inception` | `INCEPTION_API_KEY` | Inception |
| `ollama_cloud` | `OLLAMA_CLOUD_API_KEY` | Ollama Cloud |
| `zhipu` | `ZHIPU_API_KEY` | Zhipu (GLM) |
| `tanzu_ai` | `TANZU_AI_API_KEY` | Tanzu |
| `custom_tensorix` | `TENSORIX_API_KEY` | Tensorix |
| `ovhcloud` | `OVHCLOUD_API_KEY` | OVH Cloud |

### Local/Development Providers (no API key required)

| Provider ID | API Key Env Variable |
|-------------|----------------------|
| `lmstudio` | (none - local) |
| `llama_swap` | (none - local) |

---

## Common Mistakes

### ❌ Wrong: Using display name
```rust
// These will FAIL
provider: "DeepSeek"
provider: "deepseek"
provider: "OpenAI"
provider: "openai"
```

### ✅ Correct: Using provider ID
```rust
// These will WORK
provider: "custom_deepseek"  // DeepSeek requires this ID!
provider: "openai"          // OpenAI uses just "openai"
provider: "xai"            // xAI uses just "xai"
```

---

## Setting API Keys via Environment Variables

You can export multiple API keys at once:

```bash
# xAI (Grok)
export XAI_API_KEY="your-xai-api-key"

# Anthropic (Claude)
export ANTHROPIC_API_KEY="your-anthropic-api-key"

# OpenAI
export OPENAI_API_KEY="your-openai-api-key"

# Google (Gemini)
export GOOGLE_API_KEY="your-google-api-key"

# OpenRouter
export OPENROUTER_API_KEY="your-openrouter-api-key"

# DeepSeek (uses custom_deepseek as provider ID)
export DEEPSEEK_API_KEY="your-deepseek-api-key"

# Groq
export GROQ_API_KEY="your-groq-api-key"

# Mistral
export MISTRAL_API_KEY="your-mistral-api-key"

# NVIDIA
export NVIDIA_API_KEY="your-nvidia-api-key"
```

---

## How Provider Switching Works in EduCraw

When switching models, the flow is:

1. **Check if provider needs to change** - If the new model belongs to a different provider
2. **Switch provider first** - Send `SetSessionConfigOptionRequest` with `configId="provider"` and `value="<provider_id>"`
3. **Then switch model** - Send `SetSessionModelRequest` with `modelId=<model_name>`

Example switching from xAI to DeepSeek:

```rust
// Step 1: Switch provider (CRITICAL - use provider ID "custom_deepseek", NOT "deepseek")
cx.send_request(SetSessionConfigOptionRequest {
    session_id: session_id.clone(),
    config_id: ConfigId::new("provider"),
    value: ValueId::new("custom_deepseek"),  // <-- provider ID
}).block_task().await?;

// Step 2: Then switch model
cx.send_request(SetSessionModelRequest::new(
    session_id.clone(),
    "deepseek-v4-pro",  // model name
)).block_task().await?;
```

---

## Important Notes

1. **DeepSeek specifically uses `custom_deepseek`** as its provider ID (not "deepseek" or "DeepSeek")
2. **Environment variables are checked first** before Goose's internal config storage
3. **Set all your API keys upfront** via export, so switching providers works instantly without reconfiguration
4. **Provider IDs are case-sensitive** - always use lowercase unless specified otherwise

---

## Verifying Available Providers

To see all available providers and their IDs at runtime, send a `ListProvidersRequest`:

```rust
let providers = cx.send_request(ListProvidersRequest::new()).block_task().await?;
for entry in providers.entries {
    println!("Provider ID: {}", entry.provider_id);
    println!("Display Name: {}", entry.provider_name);
    for model in entry.models {
        println!("  - {}", model.id);
    }
}
```