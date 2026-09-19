"use client";

import React, { useState, useEffect, useRef } from "react";
import { Key, Send, AlertCircle, CheckCircle2, Server, Database, Terminal, Cpu, Play, RefreshCw, Layers } from "lucide-react";

interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: string;
  sqlSnippet?: string;
}

interface ModelOption {
  id: string;
  name: string;
  free: boolean;
}

interface DBRow {
  entity_id: string;
  entity_name: string;
  attribute: string;
  value: string;
}

export default function SubStrataDashboard() {
  const [apiKey, setApiKey] = useState("");
  const [isKeySaved, setIsKeySaved] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [tenantId, setTenantId] = useState("TENANT_ALPHA");
  const [postgresStatus, setPostgresStatus] = useState<"checking" | "online" | "offline">("checking");
  const [isMounted, setIsMounted] = useState(false);

  // Model Selection
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("mistralai/mistral-small-24b-instruct-2501:free");

  // Database Inspection State
  const [dbData, setDbData] = useState<DBRow[]>([]);
  const [isLoadingDb, setIsLoadingDb] = useState(false);

  const [inputMessage, setInputMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

// Ensure timestamps only generate on the client side
useEffect(() => {
  setIsMounted(true);
  setMessages([
    {
      id: "1",
      sender: "agent",
      text: "SubStrata Engine v0.1 Online. Select model, paste API key, and submit entity requests.",
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  fetchModels();
  checkHealth();
}, []);

  useEffect(() => {
    if (postgresStatus === "online") {
      fetchTenantDB();
    }
  }, [tenantId, postgresStatus]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchModels = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/v1/models");
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data.models);
      }
    } catch {
      console.error("Could not fetch models.");
    }
  };

  const checkHealth = async () => {
    try {
      const res = await fetch("http://localhost:8000/health/db");
      setPostgresStatus(res.ok ? "online" : "offline");
    } catch {
      setPostgresStatus("offline");
    }
  };

  const fetchTenantDB = async () => {
    setIsLoadingDb(true);
    try {
      const res = await fetch(`http://localhost:8000/api/v1/inspect/${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        setDbData(data.data || []);
      }
    } catch {
      console.error("Failed to inspect tenant DB.");
    } finally {
      setIsLoadingDb(false);
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
        body: JSON.stringify({ key: apiKey }),
      });

      const data = await res.json();
      if (res.ok && data.valid) {
        setIsKeySaved(true);
        setKeyError("");
      } else {
        setIsKeySaved(false);
        setKeyError(data.detail || "Invalid Key");
      }
    } catch {
      setIsKeySaved(false);
      setKeyError("Backend unreachable");
    } finally {
      setIsVerifying(false);
    }
  };

  const extractSql = (text: string) => {
    const match = text.match(/```sql([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
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

      if (res.ok) {
        const sqlSnippet = extractSql(data.reply);
        const agentMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "agent",
          text: data.reply,
          timestamp: new Date().toLocaleTimeString(),
          sqlSnippet: sqlSnippet || undefined,
        };
        setMessages((prev) => [...prev, agentMsg]);
      } else {
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "agent",
          text: `Error: ${data.detail || "Execution failed."}`,
          timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } catch {
      const serverErr: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: "agent",
        text: "Error connecting to SubStrata Backend Server.",
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, serverErr]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteSql = async (query: string) => {
    try {
      const res = await fetch("http://localhost:8000/api/v1/execute-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, tenant_id: tenantId }),
      });

      const data = await res.json();
      if (res.ok) {
        alert("SQL Executed Successfully! Refreshing DB Inspector...");
        fetchTenantDB();
      } else {
        alert(`Execution Error: ${data.detail}`);
      }
    } catch {
      alert("Failed to connect to backend for SQL execution.");
    }
  };

  if (!isMounted) return null;

  return (
    <div className="min-h-screen bg-[#0d0e12] text-[#f2ede1] font-mono p-4 md:p-8 flex flex-col justify-between">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-[#e2481e] text-[#0d0e12] p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center shadow-lg border border-[#f05c35]">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-80">
              <Server className="w-4 h-4" /> SUBSTRATA ENGINE // EAV DYNAMIC AGENT
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tighter mt-1">
              SUBSTRATA-01
            </h1>
          </div>

          <div className="mt-4 md:mt-0 bg-[#12141c] text-[#f2ede1] p-3 rounded-xl flex items-center gap-3 border border-[#333] w-full md:w-auto">
            <Key className="w-5 h-5 text-[#e2481e]" />
            <input
              type="password"
              placeholder="Paste OpenRouter API Key"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setIsKeySaved(false);
              }}
              className="bg-transparent text-xs text-[#f2ede1] focus:outline-none w-full md:w-64"
            />
            <button
              onClick={handleSaveKey}
              disabled={isVerifying || !apiKey.trim()}
              className="bg-[#e2481e] text-[#0d0e12] hover:bg-[#ff5729] disabled:opacity-50 px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
            >
              {isVerifying ? "VERIFYING..." : isKeySaved ? "SAVED" : "SAVE"}
            </button>
            {isKeySaved && <CheckCircle2 className="w-5 h-5 text-green-500" />}
            {keyError && (<span title={keyError}><AlertCircle className="w-5 h-5 text-red-500" /></span>)}
          </div>
        </div>

        {/* Dashboard Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Controls Panel */}
          <div className="bg-[#ede7d8] text-[#0d0e12] p-6 rounded-2xl flex flex-col justify-between border border-[#d6cfbe]">
            <div className="space-y-6">
              <div className="flex justify-between items-center border-b border-[#c8c0ae] pb-3">
                <span className="font-extrabold text-sm tracking-wider uppercase flex items-center gap-2">
                  <Database className="w-4 h-4" /> SYSTEM STATUS
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  postgresStatus === "online" ? "bg-green-300 text-green-900" : "bg-red-300 text-red-900"
                }`}>
                  {postgresStatus === "online" ? "POSTGRES READY" : "OFFLINE"}
                </span>
              </div>

              {/* Model Dropdown */}
              <div>
                <label className="text-xs font-bold text-[#555] uppercase flex items-center gap-1.5 mb-2">
                  <Cpu className="w-4 h-4 text-[#e2481e]" /> Select LLM Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-[#0d0e12] text-[#f2ede1] p-3 rounded-xl text-xs font-mono font-bold focus:outline-none border border-[#333]"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tenant Switcher */}
              <div>
                <label className="text-xs font-bold text-[#555] uppercase block mb-2">
                  Active Tenant Context
                </label>
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="w-full bg-[#0d0e12] text-[#f2ede1] p-3 rounded-xl text-xs font-mono font-bold focus:outline-none"
                >
                  <option value="TENANT_ALPHA">TENANT_ALPHA</option>
                  <option value="TENANT_BETA">TENANT_BETA</option>
                  <option value="TENANT_GAMMA">TENANT_GAMMA</option>
                </select>
              </div>
            </div>

            <div className="mt-8 text-[10px] text-[#777] border-t border-[#c8c0ae] pt-4 leading-relaxed">
              SUBSTRATA EAV ARCHITECTURE v0.1<br />
              ACTIVE MODEL: {selectedModel}
            </div>
          </div>

          {/* Terminal Panel */}
          <div className="lg:col-span-2 bg-[#12141c] rounded-2xl p-6 border border-[#222530] flex flex-col h-[520px]">
            <div className="flex justify-between items-center pb-4 border-b border-[#222530] mb-4">
              <span className="text-xs font-bold tracking-widest text-[#e2481e] flex items-center gap-2">
                <Terminal className="w-4 h-4" /> QUERY TERMINAL
              </span>
              <span className="text-[10px] text-[#666]">
                MODEL: <span className="text-[#e2481e] font-bold">{selectedModel.split("/")[1] || selectedModel}</span>
              </span>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-4 rounded-xl text-xs leading-relaxed max-w-[90%] ${
                    msg.sender === "user"
                      ? "bg-[#222530] text-[#f2ede1] ml-auto border border-[#333748]"
                      : "bg-[#181a24] text-[#a0a5b5] border border-[#232736]"
                  }`}
                >
                  <div className="text-[9px] text-[#555] mb-1 font-bold">
                    {msg.sender === "user" ? "YOU" : "SUBSTRATA_AGENT"} // {msg.timestamp}
                  </div>
                  <div className="whitespace-pre-wrap">{msg.text}</div>

                  {/* SQL Execution Trigger Button */}
                  {msg.sqlSnippet && (
                    <div className="mt-3 pt-3 border-t border-[#2d3245] flex items-center justify-between">
                      <span className="text-[10px] font-bold text-[#e2481e]">SQL QUERY DETECTED</span>
                      <button
                        onClick={() => handleExecuteSql(msg.sqlSnippet!)}
                        className="bg-[#e2481e] text-[#0d0e12] hover:bg-[#ff5729] px-3 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-all"
                      >
                        <Play className="w-3 h-3 fill-current" /> EXECUTE ON DB
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {isProcessing && (
                <div className="bg-[#181a24] text-[#a0a5b5] p-4 rounded-xl text-xs border border-[#232736] animate-pulse">
                  Processing EAV logic with model [{selectedModel}]...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Form */}
            <form onSubmit={handleSendMessage} className="mt-4 flex gap-2">
              <input
                type="text"
                placeholder={isKeySaved ? "Type EAV entity instruction..." : "Save API Key above to begin..."}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                disabled={!isKeySaved || isProcessing}
                className="flex-1 bg-[#181a24] border border-[#2d3245] rounded-xl px-4 py-3 text-xs text-[#f2ede1] focus:outline-none focus:border-[#e2481e] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!isKeySaved || !inputMessage.trim() || isProcessing}
                className="bg-[#e2481e] text-[#0d0e12] hover:bg-[#ff5729] disabled:opacity-50 px-5 py-3 rounded-xl transition-all font-bold"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

        </div>

        {/* Database Inspector Panel */}
        <div className="bg-[#12141c] rounded-2xl p-6 border border-[#222530] space-y-4">
          <div className="flex justify-between items-center border-b border-[#222530] pb-3">
            <span className="text-xs font-bold text-[#e2481e] flex items-center gap-2">
              <Layers className="w-4 h-4" /> LIVE DB INSPECTOR // TENANT: {tenantId}
            </span>
            <button
              onClick={fetchTenantDB}
              disabled={isLoadingDb}
              className="bg-[#1f2330] hover:bg-[#2a3042] text-[#f2ede1] px-3 py-1 rounded text-xs flex items-center gap-1 border border-[#333]"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingDb ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#222530] text-[#777]">
                  <th className="py-2 px-3">Entity ID</th>
                  <th className="py-2 px-3">Entity Name</th>
                  <th className="py-2 px-3">Attribute Name</th>
                  <th className="py-2 px-3">Attribute Value</th>
                </tr>
              </thead>
              <tbody>
                {dbData.map((row, idx) => (
                  <tr key={idx} className="border-b border-[#1a1d29] hover:bg-[#181a24] text-[#a0a5b5]">
                    <td className="py-2 px-3 font-bold text-[#e2481e]">{row.entity_id || "-"}</td>
                    <td className="py-2 px-3 text-[#f2ede1]">{row.entity_name || "-"}</td>
                    <td className="py-2 px-3">{row.attribute || "-"}</td>
                    <td className="py-2 px-3 text-green-400">{row.value || "-"}</td>
                  </tr>
                ))}
                {dbData.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[#555]">
                      No dynamic entities or attributes recorded for context {tenantId}. Execute an agent query to populate.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}