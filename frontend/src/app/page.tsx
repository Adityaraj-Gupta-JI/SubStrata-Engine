"use client";

import { useState, useEffect } from "react";
import { Key, Database, Cpu, Send, ShieldCheck, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

export default function SubStrataDashboard() {
  const [apiKey, setApiKey] = useState("");
  const [isKeyValid, setIsKeyValid] = useState(false);
  const [tenantId, setTenantId] = useState("tenant_alpha");
  const [dbStatus, setDbStatus] = useState<"checking" | "connected" | "error">("checking");
  const [inputMessage, setInputMessage] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ role: "user" | "agent"; content: string }>>([
    { role: "agent", content: "SubStrata Core v0.1 Online. Supply your OpenRouter key to begin EAV execution." }
  ]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem("substrata_openrouter_key");
    if (savedKey) {
      setApiKey(savedKey);
      verifyKey(savedKey);
    }
    checkHealth();
  }, []);

  const checkHealth = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/health/db");
      if (res.ok) setDbStatus("connected");
      else setDbStatus("error");
    } catch {
      setDbStatus("error");
    }
  };

  const verifyKey = async (keyToVerify: string) => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/v1/verify-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: keyToVerify }),
      });
      if (res.ok) {
        setIsKeyValid(true);
        localStorage.setItem("substrata_openrouter_key", keyToVerify);
      } else {
        setIsKeyValid(false);
      }
    } catch {
      setIsKeyValid(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !apiKey) return;

    const userMsg = inputMessage;
    setInputMessage("");
    setChatLog((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch("http://127.0.0.1:8000/api/v1/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenRouter-API-Key": apiKey,
        },
        body: JSON.stringify({ message: userMsg, tenant_id: tenantId }),
      });

      const data = await res.json();
      if (res.ok) {
        setChatLog((prev) => [...prev, { role: "agent", content: data.reply }]);
      } else {
        setChatLog((prev) => [...prev, { role: "agent", content: `Error: ${data.detail || "Request failed"}` }]);
      }
    } catch (err: any) {
      setChatLog((prev) => [...prev, { role: "agent", content: `Network Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0b10] text-[#f2ede1] p-4 md:p-8 font-mono">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-4">
        
        {/* CARD 1: HERO & BYOK BANNER (2:1 Span) */}
        <div className="md:col-span-12 bg-[#e2481e] text-[#12141c] p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center shadow-lg">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold tracking-widest uppercase mb-1">
              <Cpu className="w-4 h-4" /> SUBSTRATA ENGINE // EAV DYNAMIC AGENT
            </div>
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter">SUBSTRATA-01</h1>
          </div>
          <div className="mt-4 md:mt-0 bg-[#12141c] text-[#f2ede1] p-3 rounded-xl flex items-center gap-3 border border-[#333]">
            <Key className="w-5 h-5 text-[#e2481e]" />
            <input
              type="password"
              placeholder="Paste OpenRouter API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="bg-transparent text-xs text-[#f2ede1] focus:outline-none w-48 md:w-64"
            />
            <button
              onClick={() => verifyKey(apiKey)}
              className="bg-[#e2481e] text-[#12141c] px-3 py-1 text-xs font-bold rounded-lg hover:brightness-110"
            >
              SAVE
            </button>
            {isKeyValid ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <AlertCircle className="w-5 h-5 text-red-400" />}
          </div>
        </div>

        {/* CARD 2: TENANT & SYSTEM SPEC SHEET */}
        <div className="md:col-span-4 bg-[#e8dcc8] text-[#12141c] p-6 rounded-2xl flex flex-col justify-between min-h-[400px]">
          <div>
            <div className="flex justify-between items-center border-b border-[#12141c]/20 pb-3 mb-4">
              <span className="text-xs font-bold tracking-wider">SYSTEM STATUS</span>
              <span className="text-xs uppercase bg-[#12141c] text-[#e8dcc8] px-2 py-0.5 rounded font-bold">
                {dbStatus}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-[#12141c]/70 block mb-1">ACTIVE TENANT ISOLATION</label>
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="w-full bg-[#12141c] text-[#f2ede1] p-2 text-xs rounded-lg font-mono focus:outline-none"
                >
                  <option value="tenant_alpha">TENANT_ALPHA</option>
                  <option value="tenant_beta">TENANT_BETA</option>
                  <option value="tenant_gamma">TENANT_GAMMA</option>
                </select>
              </div>

              <div className="border border-[#12141c]/30 rounded-xl p-3 bg-white/40">
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span>POSTGRES HEALTH</span>
                  <span>{dbStatus === "connected" ? "100%" : "OFFLINE"}</span>
                </div>
                <div className="w-full bg-[#12141c]/20 h-2 rounded-full overflow-hidden">
                  <div className={`h-full ${dbStatus === "connected" ? "bg-[#e2481e]" : "bg-red-500"} w-full`}></div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#12141c]/20 text-[10px] space-y-1 opacity-70">
            <div>PART NO: SUBSTRATA-EAV-2026</div>
            <div>MODEL: QWEN-2.5-72B-INSTRUCT</div>
            <div className="font-mono tracking-widest pt-2">||||| |||| ||||||| ||| |||</div>
          </div>
        </div>

        {/* CARD 3: TERMINAL CHAT INTERFACE */}
        <div className="md:col-span-8 bg-[#12141c] border border-[#222] p-6 rounded-2xl flex flex-col justify-between min-h-[500px]">
          <div className="flex justify-between items-center border-b border-[#222] pb-3 mb-4">
            <span className="text-xs text-[#e2481e] font-bold tracking-widest flex items-center gap-2">
              <Database className="w-4 h-4" /> QUERY TERMINAL
            </span>
            <span className="text-xs text-[#666]">TENANT: {tenantId.toUpperCase()}</span>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto space-y-3 mb-4 max-h-[360px] pr-2">
            {chatLog.map((msg, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl text-xs leading-relaxed max-w-[85%] ${
                  msg.role === "user"
                    ? "bg-[#e2481e] text-[#12141c] font-bold self-end ml-auto"
                    : "bg-[#1b2030] text-[#f2ede1] border border-[#2e374d]"
                }`}
              >
                {msg.content}
              </div>
            ))}
            {loading && (
              <div className="text-xs text-[#e2481e] flex items-center gap-2 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" /> Querying EAV Engine...
              </div>
            )}
          </div>

          {/* Query Input Form */}
          <div className="flex gap-2 bg-[#1b2030] p-2 rounded-xl border border-[#2e374d]">
            <input
              type="text"
              placeholder={isKeyValid ? "Ask SubStrata (e.g., 'Add product laptop with price 1200')" : "Verify API Key above to start querying..."}
              disabled={!isKeyValid || loading}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              className="flex-1 bg-transparent text-xs text-[#f2ede1] focus:outline-none px-2 disabled:opacity-50"
            />
            <button
              onClick={handleSendMessage}
              disabled={!isKeyValid || loading}
              className="bg-[#e2481e] text-[#12141c] p-2 rounded-lg disabled:opacity-50 hover:brightness-110"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}