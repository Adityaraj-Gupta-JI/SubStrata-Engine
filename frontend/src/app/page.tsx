"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Key,
  Send,
  AlertCircle,
  CheckCircle2,
  Server,
  Database,
  Terminal,
  Cpu,
  Play,
  RefreshCw,
  Zap,
  Shield,
  Sword,
  Activity,
  Code2,
  Layers,
  ChevronRight,
  Copy,
  Check,
  Trash2,
  Search,
} from "lucide-react";

interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: string;
}

interface ModelOption {
  id: string;
  name: string;
  free: boolean;
}

interface EAVRow {
  entity_id: string;
  entity_name: string;
  attribute: string;
  value: string;
}

interface ToastState {
  message: string;
  type: "success" | "error" | "info";
}

const DEFAULT_MODELS: ModelOption[] = [
  {
    id: "mistralai/mistral-small-24b-instruct-2501:free",
    name: "Mistral Small 24B (FREE / SWIFT)",
    free: true,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B (FREE / HEAVY KATANA)",
    free: true,
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek R1 Reasoner (FREE / SHADOW ENGINE)",
    free: true,
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash (FREE / LIGHTNING SPEED)",
    free: true,
  },
  {
    id: "qwen/qwen-2.5-72b-instruct",
    name: "Qwen 2.5 72B (PAID / RONIN TACTICAL)",
    free: false,
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet (PAID / SHOGUN MASTER)",
    free: false,
  },
];

const TENANTS = ["TENANT_ALPHA", "TENANT_BETA", "TENANT_GAMMA"];

const DEFAULT_TENANT_SEEDS: Record<string, EAVRow[]> = {
  TENANT_ALPHA: [
    {
      entity_id: "e_101",
      entity_name: "UserProfile",
      attribute: "katana_skill",
      value: "Master (100)",
    },
    {
      entity_id: "e_101",
      entity_name: "UserProfile",
      attribute: "security_clearance",
      value: "Level 5 Shogun",
    },
    {
      entity_id: "e_102",
      entity_name: "SystemConfig",
      attribute: "db_mode",
      value: "EAV-Cyber-Dynamic",
    },
    {
      entity_id: "e_102",
      entity_name: "SystemConfig",
      attribute: "cyberware_firewall",
      value: "ACTIVE_BUSHI",
    },
  ],
  TENANT_BETA: [
    {
      entity_id: "e_201",
      entity_name: "CyberGear",
      attribute: "sku",
      value: "KATANA-NEON-99",
    },
    {
      entity_id: "e_201",
      entity_name: "CyberGear",
      attribute: "price",
      value: "2,400 EuroDollars",
    },
    {
      entity_id: "e_201",
      entity_name: "CyberGear",
      attribute: "durability",
      value: "98.5%",
    },
  ],
  TENANT_GAMMA: [
    {
      entity_id: "e_301",
      entity_name: "RoninContract",
      attribute: "client_id",
      value: "gamma_corp_tokyo",
    },
    {
      entity_id: "e_301",
      entity_name: "RoninContract",
      attribute: "status",
      value: "EXECUTIVE_EXECUTION",
    },
  ],
};

export default function SubStrataCyberDashboard() {
  const [apiKey, setApiKey] = useState("");
  const [isKeySaved, setIsKeySaved] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [keyError, setKeyError] = useState("");

  const [tenantId, setTenantId] = useState("TENANT_ALPHA");
  const [selectedEntityFilter, setSelectedEntityFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  // Model Selection State
  const [availableModels, setAvailableModels] =
    useState<ModelOption[]>(DEFAULT_MODELS);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODELS[0].id);

  // Data & Terminal State
  const [inputMessage, setInputMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [dbRows, setDbRows] = useState<EAVRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Toast & Interactive State
  const [toast, setToast] = useState<ToastState | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info" = "info") => {
      setToast({ message, type });
      setTimeout(() => {
        setToast(null);
      }, 4000);
    },
    []
  );

  const loadTenantData = useCallback((tenant: string) => {
    if (typeof window === "undefined") return;
    const storageKey = `substrata_cyber_db_${tenant}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setDbRows(JSON.parse(stored));
        return;
      } catch (e) {
        console.error("Failed to parse local Cyber-EAV DB", e);
      }
    }
    const defaultData = DEFAULT_TENANT_SEEDS[tenant] || [];
    setDbRows(defaultData);
    localStorage.setItem(storageKey, JSON.stringify(defaultData));
  }, []);

  const setTenantDataLocal = (tenant: string, rows: EAVRow[]) => {
    if (typeof window === "undefined") return;
    const storageKey = `substrata_cyber_db_${tenant}`;
    localStorage.setItem(storageKey, JSON.stringify(rows));
    setDbRows(rows);
  };

  useEffect(() => {
    setIsMounted(true);

    const savedKey = localStorage.getItem("openrouter_api_key");
    if (savedKey) {
      setApiKey(savedKey);
      setIsKeySaved(true);
    }

    setMessages([
      {
        id: "1",
        sender: "agent",
        text: "SUBSTRATA-01 [侍 SAMURAI ENGINE] ACTIVE.\nMulti-Tenant EAV Schema protocol initialized. Input your OpenRouter key above to ignite the Neural Katana Agent.",
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    fetchModels();
    loadTenantData(tenantId);
  }, [loadTenantData, tenantId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchModels = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/v1/models");
      if (res.ok) {
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setAvailableModels(data.models);
        }
      }
    } catch {
      // Retain DEFAULT_MODELS if backend service is unreachable
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setIsVerifying(true);
    setKeyError("");

    try {
      const res = await fetch("http://localhost:8000/api/v1/verify-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.valid) {
        setIsKeySaved(true);
        localStorage.setItem("openrouter_api_key", apiKey.trim());
        showToast("OpenRouter Key verified & ignited successfully!", "success");
      } else {
        if (apiKey.trim().length > 10) {
          setIsKeySaved(true);
          localStorage.setItem("openrouter_api_key", apiKey.trim());
          showToast("Key saved locally for direct OpenRouter access.", "info");
        } else {
          setIsKeySaved(false);
          setKeyError(data.detail || "Invalid OpenRouter API Key format");
        }
      }
    } catch {
      if (apiKey.trim().length > 10) {
        setIsKeySaved(true);
        localStorage.setItem("openrouter_api_key", apiKey.trim());
        showToast("Saved Key locally (Standalone client mode)", "info");
      } else {
        setIsKeySaved(false);
        setKeyError("Key validation failed");
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || !isKeySaved || isProcessing) return;

    const userText = inputMessage;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: "user",
      text: userText,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage("");
    setIsProcessing(true);

    try {
      const res = await fetch("http://localhost:8000/api/v1/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenRouter-Api-Key": apiKey,
        },
        body: JSON.stringify({
          message: userText,
          tenant_id: tenantId,
          model: selectedModel,
        }),
      });

      const data = await res.json();

      if (res.ok && data.reply) {
        const agentMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "agent",
          text: data.reply,
          timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, agentMsg]);
      } else {
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "agent",
          text: `[SYSTEM ERROR]: ${
            data.detail || "Execution failed via OpenRouter Agent."
          }`,
          timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } catch (err: any) {
      const serverErr: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: "agent",
        text: `[CYBER LINK FAIL]: Could not connect to SubStrata Python backend. ${
          err.message || ""
        }`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, serverErr]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyCode = (code: string, blockId: string) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = code;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);

      setCopiedIndex(blockId);
      showToast("SQL query copied to clipboard!", "info");
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      showToast("Failed to copy text", "error");
    }
  };

  const handleExecuteSql = (sql: string) => {
    try {
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      let updatedRows = [...dbRows];
      let itemsAdded = 0;

      statements.forEach((stmt) => {
        const upper = stmt.toUpperCase();

        if (upper.includes("INSERT INTO") || upper.includes("VALUES")) {
          const valuesMatch = stmt.match(/VALUES\s*([\s\S]*)/i);
          if (valuesMatch) {
            const rowGroups = valuesMatch[1].match(/\(([^)]+)\)/g);
            if (rowGroups) {
              rowGroups.forEach((group) => {
                const parts = group
                  .replace(/[()]/g, "")
                  .split(",")
                  .map((p) => p.trim().replace(/^['"]|['"]$/g, ""));

                const entityName =
                  parts.length >= 3
                    ? parts[2]
                    : parts.length >= 2
                    ? parts[1]
                    : "NewEntity";

                updatedRows.push({
                  entity_id: `e_${Date.now().toString().slice(-3)}_${Math.floor(
                    Math.random() * 89 + 10
                  )}`,
                  entity_name: entityName,
                  attribute: parts[0] || "custom_attr",
                  value: parts[1] || parts[parts.length - 1] || "active_val",
                });
                itemsAdded++;
              });
            }
          }
        }
      });

      if (itemsAdded === 0) {
        updatedRows.push({
          entity_id: `e_${Date.now().toString().slice(-4)}`,
          entity_name: "ExecutedQuery",
          attribute: "sql_statement",
          value: sql.slice(0, 40) + "...",
        });
      }

      setTenantDataLocal(tenantId, updatedRows);
      showToast(
        `⚔️ [SAMURAI EAV ENGINE]: Query executed & committed to ${tenantId} matrix!`,
        "success"
      );
    } catch (e: any) {
      showToast(`Execution Error: ${e.message || e}`, "error");
    }
  };

  const renderFormattedMessage = (msg: ChatMessage) => {
    const codeBlockRegex = /```(?:sql|SQL|postgresql|db)?\s*([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    let blockCounter = 0;

    while ((match = codeBlockRegex.exec(msg.text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          content: msg.text.slice(lastIndex, match.index),
        });
      }

      parts.push({
        type: "code",
        content: match[1].trim(),
        id: `${msg.id}_code_${blockCounter++}`,
      });

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < msg.text.length) {
      parts.push({
        type: "text",
        content: msg.text.slice(lastIndex),
      });
    }

    if (parts.length === 0) {
      return <div className="whitespace-pre-wrap font-mono">{msg.text}</div>;
    }

    return (
      <div className="space-y-3 font-mono">
        {parts.map((part, idx) => {
          if (part.type === "text") {
            return (
              <div
                key={idx}
                className="whitespace-pre-wrap text-xs text-[#c3cedc] leading-relaxed"
              >
                {part.content}
              </div>
            );
          }

          if (part.type === "code") {
            const isCopied = copiedIndex === part.id;
            return (
              <div
                key={part.id}
                className="my-3 rounded-lg border border-[#ff0055]/40 bg-[#090a10] overflow-hidden shadow-[0_0_15px_rgba(255,0,85,0.15)]"
              >
                <div className="bg-[#121524] px-3 py-2 flex items-center justify-between border-b border-[#1f2438]">
                  <div className="flex items-center gap-2 text-[10px] text-[#ff0055] font-bold tracking-wider uppercase">
                    <Code2 className="w-3.5 h-3.5" /> SQL QUERY BLOCK
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyCode(part.content, part.id!)}
                      className="text-[10px] text-[#8b9bb4] hover:text-[#00f0ff] bg-[#1a1e30] px-2.5 py-1 rounded transition-all flex items-center gap-1 border border-[#2a3047]"
                      title="Copy SQL Code"
                    >
                      {isCopied ? (
                        <Check className="w-3 h-3 text-[#00f0ff]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {isCopied ? "COPIED" : "COPY"}
                    </button>
                    <button
                      onClick={() => handleExecuteSql(part.content)}
                      className="bg-[#ff0055] hover:bg-[#ff226e] text-black font-extrabold text-[10px] px-3 py-1 rounded transition-all shadow-[0_0_10px_rgba(255,0,85,0.5)] flex items-center gap-1 uppercase cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-black" /> EXECUTE ON{" "}
                      {tenantId}
                    </button>
                  </div>
                </div>

                <pre className="p-3 text-[11px] text-[#00f0ff] overflow-x-auto font-mono bg-[#07080f] leading-relaxed">
                  <code>{part.content}</code>
                </pre>
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  };

  const uniqueEntities = Array.from(new Set(dbRows.map((r) => r.entity_name)));

  const filteredRows = dbRows.filter((r) => {
    const matchesEntity =
      selectedEntityFilter === "ALL" || r.entity_name === selectedEntityFilter;
    const matchesSearch =
      !searchQuery.trim() ||
      r.entity_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.attribute.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.value.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesEntity && matchesSearch;
  });

  if (!isMounted) return null;

  return (
    <main className="min-h-screen bg-[#07080c] text-[#e0e6ed] font-mono p-3 md:p-6 select-none relative overflow-x-hidden">
      {/* TOAST NOTIFICATION BANNER */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg border font-mono text-xs shadow-2xl flex items-center gap-3 transition-all animate-bounce ${
            toast.type === "success"
              ? "bg-[#00f0ff]/20 border-[#00f0ff] text-[#00f0ff] shadow-[0_0_20px_rgba(0,240,255,0.4)]"
              : toast.type === "error"
              ? "bg-[#ff0055]/20 border-[#ff0055] text-[#ff0055] shadow-[0_0_20px_rgba(255,0,85,0.4)]"
              : "bg-[#131522] border-[#2d334d] text-white"
          }`}
        >
          <Zap className="w-4 h-4 animate-pulse" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* BACKGROUND CYBER MESH OVERLAY */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03] z-0"
        style={{
          backgroundImage:
            "radial-gradient(#ff0055 1px, transparent 1px), radial-gradient(#00f0ff 1px, #07080c 1px)",
          backgroundSize: "40px 40px",
          backgroundPosition: "0 0, 20px 20px",
        }}
      />

      <div className="max-w-7xl mx-auto space-y-6 relative z-10">
        {/* TOP SAMURAI CYBER HEADER */}
        <header className="relative bg-[#0d0e17] border-2 border-[#ff0055]/80 p-5 rounded-xl shadow-[0_0_25px_rgba(255,0,85,0.25)] flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-4 w-full lg:w-auto">
            <div className="relative flex items-center justify-center w-12 h-12 bg-[#ff0055]/10 border border-[#ff0055] rounded-lg shadow-[0_0_15px_#ff0055]">
              <Sword className="w-7 h-7 text-[#ff0055] animate-pulse" />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#00f0ff] rounded-full border border-black" />
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#ff0055] bg-[#ff0055]/10 px-2 py-0.5 border border-[#ff0055]/40 rounded">
                  階層 // SUBSTRATA-01
                </span>
                <span className="text-[10px] text-[#00f0ff] font-bold tracking-widest flex items-center gap-1">
                  <Activity className="w-3 h-3 animate-spin" /> BUSHIDO
                  PROTOCOL
                </span>
              </div>
              <h1 className="text-2xl md:text-4xl font-black tracking-wider text-white uppercase mt-1 flex items-center gap-2 flex-wrap">
                KATANA EAV ENGINE{" "}
                <span className="text-[#ff0055] text-xs font-mono font-normal tracking-normal border-l-2 border-[#ff0055] pl-2">
                  侍 SAMURAI CORE
                </span>
              </h1>
            </div>
          </div>

          {/* OPENROUTER API KEY ENTRY */}
          <div className="w-full lg:w-auto bg-[#131522] border border-[#2d334d] p-2.5 rounded-lg flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shadow-inner">
            <div className="flex items-center gap-2 px-2">
              <Key className="w-4 h-4 text-[#ff0055] flex-shrink-0" />
              <input
                type="password"
                placeholder="Paste OpenRouter API Key (sk-or-...)"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setIsKeySaved(false);
                  setKeyError("");
                }}
                className="bg-transparent text-xs text-[#00f0ff] focus:outline-none flex-1 font-mono placeholder:text-[#4a5270]"
              />
            </div>

            <button
              onClick={handleSaveKey}
              disabled={isVerifying || !apiKey.trim()}
              className={`px-4 py-2 rounded-md text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 whitespace-nowrap flex-shrink-0 ${
                isKeySaved
                  ? "bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.4)]"
                  : "bg-[#ff0055] hover:bg-[#ff226e] text-black font-extrabold shadow-[0_0_15px_rgba(255,0,85,0.6)] disabled:opacity-50 disabled:cursor-not-allowed"
              }`}
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> VERIFYING...
                </>
              ) : isKeySaved ? (
                <>
                  <CheckCircle2 className="w-4 h-4" /> LINKED
                </>
              ) : (
                "IGNITE KEY"
              )}
            </button>
          </div>

          {keyError && (
            <div className="absolute -bottom-5 left-4 right-4 sm:left-auto sm:right-4 text-[10px] text-[#ff0055] flex items-center gap-1 font-bold bg-[#ff0055]/10 border border-[#ff0055]/40 rounded px-3 py-1.5">
              <AlertCircle className="w-3 h-3 flex-shrink-0" /> {keyError}
            </div>
          )}
        </header>

        {}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT PANEL: SYSTEM CONTROLS (3 COLS) */}
          <div className="lg:col-span-3 bg-[#0d0e17] border border-[#1f2438] rounded-xl p-5 flex flex-col justify-between space-y-6 shadow-lg">
            <div className="space-y-5">
              {/* SYSTEM DIAGNOSTICS */}
              <div className="border-b border-[#1f2438] pb-4">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-black text-[#8b9bb4] uppercase tracking-widest flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#00f0ff]" /> EAV MATRIX CORE
                  </span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider border bg-[#00f0ff]/10 text-[#00f0ff] border-[#00f0ff]/50">
                    DYNAMIC ENGINE
                  </span>
                </div>

                <div className="w-full bg-[#141724] h-1.5 rounded-full overflow-hidden">
                  <div className="h-full bg-[#00f0ff] w-full shadow-[0_0_8px_#00f0ff]" />
                </div>
              </div>

              {/* MODEL SELECTOR */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#8b9bb4] uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-[#ff0055]" /> Neural LLM Katana
                  </span>
                  <span className="text-[10px] text-[#ff0055]">AI-CORE</span>
                </label>

                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-[#131522] text-[#00f0ff] border border-[#2a3047] rounded-lg p-2.5 text-xs font-mono font-bold focus:outline-none focus:border-[#ff0055] transition-all cursor-pointer"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id} className="bg-[#0d0e17]">
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* TENANT ISOLATION SELECTOR */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#8b9bb4] uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-[#00f0ff]" /> Shogun Tenant
                    Context
                  </span>
                  <span className="text-[10px] text-[#00f0ff]">ISOLATED</span>
                </label>

                <div className="grid grid-cols-1 gap-2">
                  {TENANTS.map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTenantId(t);
                        setSelectedEntityFilter("ALL");
                        loadTenantData(t);
                      }}
                      className={`w-full p-2.5 rounded-lg text-xs font-bold text-left tracking-wider transition-all flex items-center justify-between border cursor-pointer ${
                        tenantId === t
                          ? "bg-[#ff0055]/15 border-[#ff0055] text-white shadow-[0_0_12px_rgba(255,0,85,0.3)]"
                          : "bg-[#131522] border-[#202538] text-[#6b7c96] hover:border-[#384363] hover:bg-[#181d2e]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-[#ff0055]" /> {t}
                      </span>
                      {tenantId === t && (
                        <ChevronRight className="w-4 h-4 text-[#ff0055]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* QUICK PROMPT INJECTORS */}
              <div className="pt-2">
                <span className="text-[10px] font-extrabold text-[#52607a] uppercase tracking-widest block mb-2">
                  // QUICK KATANA COMMANDS
                </span>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() =>
                      setInputMessage(
                        "Provision a Cyberware Inventory entity with item_id, power_cost, and damage_rating."
                      )
                    }
                    className="text-[10px] text-[#8b9bb4] hover:text-[#00f0ff] bg-[#131522] hover:bg-[#1a1d2e] p-2 rounded text-left border border-[#1f2438] transition-all cursor-pointer"
                  >
                    + Provision Cyberware Entity
                  </button>
                  <button
                    onClick={() =>
                      setInputMessage(
                        "Create a Samurai User entity with clan_id, bushido_score, and katana_type."
                      )
                    }
                    className="text-[10px] text-[#8b9bb4] hover:text-[#00f0ff] bg-[#131522] hover:bg-[#1a1d2e] p-2 rounded text-left border border-[#1f2438] transition-all cursor-pointer"
                  >
                    + Add Samurai Clan Member
                  </button>
                </div>
              </div>
            </div>

            {/* SYSTEM FOOTER METADATA */}
            <div className="pt-4 border-t border-[#1f2438] text-[10px] text-[#52607a] space-y-1">
              <p className="flex justify-between">
                <span>SYSTEM ID:</span>{" "}
                <span className="text-white font-bold">SUBSTRATA-EAV-2026</span>
              </p>
              <p className="flex justify-between">
                <span>ACTIVE CONTEXT:</span>{" "}
                <span className="text-[#ff0055] font-bold">{tenantId}</span>
              </p>
              <p className="flex justify-between">
                <span>ENCODING:</span>{" "}
                <span className="text-[#00f0ff] font-bold">BCNF_NORM_V1</span>
              </p>
            </div>
          </div>

          {}
          {/* MIDDLE PANEL: CHAT TERMINAL (5 COLS) */}
          <div className="lg:col-span-5 bg-[#0d0e17] border border-[#1f2438] rounded-xl flex flex-col h-[620px] shadow-lg overflow-hidden">
            <div className="bg-[#121421] px-4 py-3 border-b border-[#1f2438] flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-white uppercase tracking-wider">
                <Terminal className="w-4 h-4 text-[#ff0055]" />
                <span>AGENT TERMINAL LOG</span>
              </div>
              <span className="text-[10px] bg-[#ff0055]/20 text-[#ff0055] px-2 py-0.5 rounded border border-[#ff0055]/40 font-bold">
                NEURAL STRIKE
              </span>
            </div>

            {/* MESSAGES VIEWPORT */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs scrollbar-thin scrollbar-thumb-[#ff0055]/40">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-4 rounded-xl leading-relaxed max-w-[95%] transition-all ${
                    msg.sender === "user"
                      ? "bg-[#161a29] text-white ml-auto border-r-2 border-[#00f0ff] shadow-md"
                      : "bg-[#10121c] text-[#c3cedc] border border-[#1d2236]"
                  }`}
                >
                  <div className="text-[9px] text-[#52607a] mb-2 font-bold flex justify-between items-center border-b border-[#1f2438]/60 pb-1">
                    <span
                      className={
                        msg.sender === "user"
                          ? "text-[#00f0ff]"
                          : "text-[#ff0055]"
                      }
                    >
                      {msg.sender === "user"
                        ? "▶ YOU // OPERATOR"
                        : "⚔️ SUBSTRATA_AGENT // NEURAL KATANA"}
                    </span>
                    <span>{msg.timestamp}</span>
                  </div>

                  {renderFormattedMessage(msg)}
                </div>
              ))}

              {isProcessing && (
                <div className="bg-[#10121c] p-3 rounded-xl border border-[#1d2236] text-[#00f0ff] flex items-center gap-2 animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span className="text-[10px] uppercase font-bold tracking-wider">
                    EXECUTING NEURAL AGENT INFERENCE...
                  </span>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* MESSAGE INPUT FORM */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 bg-[#121421] border-t border-[#1f2438] flex items-center gap-2"
            >
              <input
                type="text"
                placeholder={
                  isKeySaved
                    ? "Type EAV directive or query for Katana Agent..."
                    : "Ignite OpenRouter API Key to start agent chat..."
                }
                value={inputMessage}
                disabled={!isKeySaved || isProcessing}
                onChange={(e) => setInputMessage(e.target.value)}
                className="flex-1 bg-[#090a10] border border-[#202538] focus:border-[#ff0055] text-xs text-white rounded-lg px-3 py-2.5 font-mono focus:outline-none transition-all placeholder:text-[#454e6b] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!isKeySaved || !inputMessage.trim() || isProcessing}
                className="bg-[#ff0055] hover:bg-[#ff226e] disabled:opacity-40 text-black font-extrabold px-4 py-2.5 rounded-lg text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-[0_0_12px_rgba(255,0,85,0.4)] cursor-pointer"
              >
                <Send className="w-3.5 h-3.5 fill-black" />
              </button>
            </form>
          </div>

          {}
          {/* RIGHT PANEL: EAV MATRIX INSPECTOR (4 COLS) */}
          <div className="lg:col-span-4 bg-[#0d0e17] border border-[#1f2438] rounded-xl flex flex-col h-[620px] shadow-lg overflow-hidden">
            {/* INSPECTOR HEADER */}
            <div className="bg-[#121421] px-4 py-3 border-b border-[#1f2438] flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-white uppercase tracking-wider">
                <Server className="w-4 h-4 text-[#00f0ff]" />
                <span>EAV DATA MATRIX INSPECTOR</span>
              </div>
              <span className="text-[10px] text-[#00f0ff] font-bold">
                {filteredRows.length} ROWS
              </span>
            </div>

            {/* CONTROLS TOOLBAR */}
            <div className="p-3 bg-[#0a0b12] border-b border-[#1f2438] space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#52607a]" />
                  <input
                    type="text"
                    placeholder="Search attributes or values..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[#131522] border border-[#202538] rounded pl-8 pr-3 py-1.5 text-[11px] text-[#00f0ff] focus:outline-none focus:border-[#00f0ff]"
                  />
                </div>
              </div>

              {/* ENTITY FILTER TAGS */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <button
                  onClick={() => setSelectedEntityFilter("ALL")}
                  className={`text-[9px] font-bold uppercase px-2 py-1 rounded whitespace-nowrap transition-all ${
                    selectedEntityFilter === "ALL"
                      ? "bg-[#00f0ff] text-black"
                      : "bg-[#131522] text-[#6b7c96] hover:text-white"
                  }`}
                >
                  ALL ({dbRows.length})
                </button>
                {uniqueEntities.map((ent) => (
                  <button
                    key={ent}
                    onClick={() => setSelectedEntityFilter(ent)}
                    className={`text-[9px] font-bold uppercase px-2 py-1 rounded whitespace-nowrap transition-all ${
                      selectedEntityFilter === ent
                        ? "bg-[#ff0055] text-black"
                        : "bg-[#131522] text-[#6b7c96] hover:text-white"
                    }`}
                  >
                    {ent}
                  </button>
                ))}
              </div>
            </div>

            {/* EAV TABLE LOG */}
            <div className="flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-[#00f0ff]/30">
              {filteredRows.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#454e6b] text-xs space-y-2">
                  <Database className="w-8 h-8 stroke-1" />
                  <p>No EAV records found in context.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRows.map((row, i) => (
                    <div
                      key={i}
                      className="bg-[#10121c] border border-[#1f2438] hover:border-[#00f0ff]/50 p-2.5 rounded-lg transition-all space-y-1 text-[11px]"
                    >
                      <div className="flex justify-between items-center text-[9px]">
                        <span className="text-[#ff0055] font-bold">
                          {row.entity_name}
                        </span>
                        <span className="text-[#52607a] font-mono">
                          ID: {row.entity_id}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-1 border-t border-[#181c2e]">
                        <span className="text-[#8b9bb4]">{row.attribute}:</span>
                        <span className="text-[#00f0ff] font-bold truncate max-w-[180px]">
                          {row.value}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* MATRIX FOOTER ACTIONS */}
            <div className="p-3 bg-[#121421] border-t border-[#1f2438] flex justify-between items-center">
              <button
                onClick={() => {
                  setTenantDataLocal(
                    tenantId,
                    DEFAULT_TENANT_SEEDS[tenantId] || []
                  );
                  showToast(`Reset ${tenantId} EAV storage to seed state`, "info");
                }}
                className="text-[10px] text-[#6b7c96] hover:text-[#ff0055] flex items-center gap-1 transition-all cursor-pointer"
              >
                <Trash2 className="w-3 h-3" /> RESET SEED
              </button>

              <span className="text-[9px] text-[#52607a]">
                TENANT MATRIX: {tenantId}
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}