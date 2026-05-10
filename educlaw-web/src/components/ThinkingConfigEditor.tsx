import { useState, useEffect } from "react";
import { Settings2, Brain } from "lucide-react";
import { api } from "../api/client";
import type { ConfigParamDef } from "../api/types";

interface Props {
  provider: string;
  value: Record<string, unknown> | null;
  onChange: (v: Record<string, unknown> | null) => void;
}

/**
 * Dynamic thinking config editor.
 * Fetches the provider schema from the backend and renders appropriate
 * controls (select dropdowns, number inputs). Falls back to raw JSON
 * editing for manual/advanced configuration.
 */
export default function ThinkingConfigEditor({
  provider,
  value,
  onChange,
}: Props) {
  const [schema, setSchema] = useState<ConfigParamDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [schemaError, setSchemaError] = useState("");

  // Fetch schema when provider changes
  useEffect(() => {
    if (!provider) {
      setSchema([]);
      setSchemaError("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSchemaError("");

    api
      .adminGetProviderSchema(provider)
      .then((res) => {
        if (!cancelled) {
          setSchema(res.params || []);
          setSchemaError("");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSchema([]);
          setSchemaError("Could not load provider schema");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Initialize raw JSON from current value
  useEffect(() => {
    if (rawMode) {
      setRawJson(value ? JSON.stringify(value, null, 2) : "");
    }
  }, [rawMode, value]);

  if (!provider) {
    return (
      <p className="text-xs text-wp-text-tertiary italic">
        Set a provider first to configure thinking parameters.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-wp-text-tertiary">
        <div className="animate-spin w-3 h-3 border-1.5 border-wp-accent border-t-transparent rounded-full" />
        Loading config schema...
      </div>
    );
  }

  if (schemaError && !rawMode) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-wp-warning">{schemaError}</p>
        <button
          onClick={() => setRawMode(true)}
          className="text-xs font-medium text-wp-accent hover:text-wp-accent-hover underline"
        >
          Edit raw JSON instead
        </button>
      </div>
    );
  }

  // No configurable params for this provider
  if (schema.length === 0 && !rawMode) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-wp-text-tertiary">
          This provider has no configurable thinking parameters.
        </p>
        <button
          onClick={() => setRawMode(true)}
          className="text-xs font-medium text-wp-accent hover:text-wp-accent-hover underline"
        >
          Add raw JSON params
        </button>
      </div>
    );
  }

  const currentValue = value || {};

  // Update a single param and propagate
  function updateParam(key: string, val: unknown) {
    const next = { ...currentValue };
    if (val === "" || val === null || val === undefined) {
      delete next[key];
    } else {
      next[key] = val;
    }
    onChange(Object.keys(next).length > 0 ? next : null);
  }

  function handleRawSave() {
    try {
      if (!rawJson.trim()) {
        onChange(null);
        setRawMode(false);
        return;
      }
      const parsed = JSON.parse(rawJson);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return; // invalid - ignore
      }
      onChange(parsed as Record<string, unknown>);
      setRawMode(false);
    } catch {
      // Invalid JSON - let user fix it
    }
  }

  function handleClearAll() {
    onChange(null);
    setRawJson("");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Brain className="w-4 h-4 text-wp-info" />
          <span className="text-sm font-semibold text-wp-text-primary">
            Thinking Configuration
          </span>
          {!rawMode && (
            <span className="text-[10px] text-wp-text-tertiary font-mono">
              {provider}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {Object.keys(currentValue).length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-[10px] text-wp-text-tertiary hover:text-wp-error transition-colors"
            >
              Clear all
            </button>
          )}
          <button
            onClick={() => {
              if (!rawMode) {
                setRawJson(value ? JSON.stringify(value, null, 2) : "");
              }
              setRawMode(!rawMode);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors
              bg-wp-accent-subtle text-wp-accent hover:bg-wp-accent-muted border border-wp-border-mid"
          >
            <Settings2 className="w-3 h-3" />
            {rawMode ? "Form mode" : "Raw JSON"}
          </button>
        </div>
      </div>

      {rawMode ? (
        <div className="space-y-2">
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            placeholder='{"thinking_type":"enabled","budget_tokens":16000}'
            rows={6}
            className="w-full px-3 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page
              focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent
              text-wp-text-primary text-xs font-mono placeholder-wp-text-tertiary resize-y"
            spellCheck={false}
          />
          <button
            onClick={handleRawSave}
            className="px-3 py-1.5 text-xs font-semibold bg-wp-success text-white rounded-wp-md hover:bg-wp-success/90 transition-colors"
          >
            Apply JSON
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {schema.map((param) => {
            const currentVal = currentValue[param.key];
            return (
              <div key={param.key}>
                <label
                  className="block text-xs font-medium text-wp-text-secondary mb-1"
                  title={param.description}
                >
                  {param.key.replace(/_/g, " ")}
                  {param.description && (
                    <span className="text-wp-text-tertiary ml-1">ⓘ</span>
                  )}
                </label>

                {param.type === "select" && param.values ? (
                  <select
                    value={
                      currentVal !== undefined && currentVal !== null
                        ? String(currentVal)
                        : ""
                    }
                    onChange={(e) =>
                      updateParam(param.key, e.target.value || null)
                    }
                    className="w-full px-2.5 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page
                      focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent
                      text-wp-text-primary text-xs"
                  >
                    <option value="">
                      {param.default !== undefined
                        ? `Default (${param.default})`
                        : "—"}
                    </option>
                    {param.values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : param.type === "integer" ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={param.min}
                      max={param.max}
                      step={1}
                      value={
                        currentVal !== undefined && currentVal !== null
                          ? Number(currentVal)
                          : ""
                      }
                      onChange={(e) =>
                        updateParam(
                          param.key,
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      placeholder={
                        param.default !== undefined
                          ? `Default: ${param.default}`
                          : ""
                      }
                      className="w-full px-2.5 py-2 rounded-wp-md border border-wp-border-mid bg-wp-page
                        focus:outline-none focus:ring-2 focus:ring-wp-accent/30 focus:border-wp-accent
                        text-wp-text-primary text-xs font-mono placeholder-wp-text-tertiary"
                    />
                  </div>
                ) : null}

                {param.description && (
                  <p className="text-[10px] text-wp-text-tertiary mt-0.5 leading-tight">
                    {param.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
