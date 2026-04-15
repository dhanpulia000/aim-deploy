import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createAuthHeaders } from "../utils/headers";
import { AiBotIcon } from "./icons/AiAssistantIcon";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sources?: Array<{
    guideId: string;
    title: string;
    relevance: number;
    excerpt: string;
  }>;
}

interface ChatBotProps {
  token?: string | null;
  context?: {
    issueId?: string;
    categoryId?: number;
    categoryGroupId?: number;
  };
  onGuideSelect?: (guideId: string) => void;
  className?: string;
}

export default function ChatBot({ token, context, onGuideSelect, className = "" }: ChatBotProps) {
  const { t, i18n } = useTranslation("pagesAgent");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages((prev) => {
      const rest = prev.filter((m) => m.id !== "welcome");
      return [
        {
          id: "welcome",
          role: "assistant" as const,
          content: t("chatBot.welcome"),
          timestamp: new Date()
        },
        ...rest
      ];
    });
  }, [t, i18n.language]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const auth = createAuthHeaders(token ?? null);
      const response = await fetch("/api/chat/ask", {
        method: "POST",
        headers: {
          ...(auth ?? {}),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: userMessage.content,
          context: {
            ...(context || {}),
            language: i18n.resolvedLanguage?.toLowerCase().startsWith("ko") ? "ko" : "en"
          }
        })
      });

      if (!response.ok) {
        throw new Error(t("chatBot.answerFailed"));
      }

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.data.answer,
        timestamp: new Date(),
        sources: data.data.sources || []
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: t("chatBot.errorGeneric"),
        timestamp: new Date()
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`flex h-full flex-col bg-slate-50/80 dark:bg-slate-900/80 ${className}`}>
      <div className="flex shrink-0 items-center gap-3 border-b border-violet-200/60 bg-gradient-to-r from-violet-600 via-indigo-600 to-sky-600 px-4 py-3.5 text-white shadow-md dark:border-violet-800/50">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 shadow-inner backdrop-blur-sm">
          <AiBotIcon className="h-5 w-5 text-white" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold tracking-tight">{t("chatBot.title")}</div>
          <div className="truncate text-xs text-white/90">{t("chatBot.subtitle")}</div>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                message.role === "user"
                  ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white ring-1 ring-white/20"
                  : "border border-violet-200/80 bg-white text-slate-800 ring-1 ring-violet-500/10 dark:border-violet-800/60 dark:bg-slate-800 dark:text-slate-100"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
              
              {/* 소스 가이드 표시 */}
              {message.sources && message.sources.length > 0 && (
                <div className="mt-3 border-t border-violet-200/70 pt-3 dark:border-violet-800/50">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                    {t("chatBot.sourceGuides")}
                  </div>
                  {message.sources.map((source, idx) => (
                    <div
                      key={idx}
                      className="mb-2 cursor-pointer rounded-xl border border-violet-200/80 bg-violet-50/90 p-2.5 text-xs transition-colors hover:border-violet-400 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:hover:bg-violet-900/40"
                      onClick={() => onGuideSelect?.(source.guideId)}
                    >
                      <div className="font-medium">{source.title}</div>
                      <div className="text-slate-500 dark:text-slate-400 mt-1">
                        {source.excerpt}
                      </div>
                      <div className="text-slate-400 dark:text-slate-500 mt-1">
                        {t("chatBot.relevance", { pct: (source.relevance * 100).toFixed(0) })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs mt-2 opacity-70">
                {message.timestamp.toLocaleTimeString(i18n.language?.startsWith("ko") ? "ko-KR" : "en-US", {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </div>
            </div>
          </div>
        ))}
        
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-violet-200/80 bg-white px-4 py-3 shadow-sm dark:border-violet-800 dark:bg-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">{t("chatBot.typing")}</span>
                <div className="flex gap-1.5">
                  <div className="h-2 w-2 animate-bounce rounded-full bg-violet-500" />
                  <div
                    className="h-2 w-2 animate-bounce rounded-full bg-indigo-500"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <div
                    className="h-2 w-2 animate-bounce rounded-full bg-sky-500"
                    style={{ animationDelay: "0.3s" }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="shrink-0 border-t border-violet-200/60 bg-white p-4 dark:border-violet-900/40 dark:bg-slate-900">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={t("chatBot.placeholder")}
            className="min-h-[52px] flex-1 resize-none rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            rows={2}
            disabled={loading}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="shrink-0 self-end rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/25 transition-all hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-500 disabled:shadow-none"
          >
            {t("chatBot.send")}
          </button>
        </div>
        {context && (context.issueId || context.categoryId) && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            {t("chatBot.contextPrefix")}{" "}
            {context.issueId ? t("chatBot.contextIssue", { id: context.issueId }) : ""}
            {context.categoryId ? ` ${t("chatBot.contextCategory", { id: context.categoryId })}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
