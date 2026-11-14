'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  History,
  Send,
  Plus,
  Trash2,
  ExternalLink,
  Sun,
  Moon,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';

export default function Home() {
  const [theme, setTheme] = useState('dark');
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentActivities, setCurrentActivities] = useState([]);
  const [currentSources, setCurrentSources] = useState([]);
  const [currentChanges, setCurrentChanges] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  const messagesEndRef = useRef(null);

  // Sync theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load conversations on mount
  useEffect(() => {
    fetchConversations();
  }, []);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentActivities, isStreaming]);

  async function fetchConversations() {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.warn('Failed to load conversations:', err);
    }
  }

  async function selectConversation(id) {
    if (isStreaming) return;
    setActiveConversationId(id);
    setErrorMessage('');
    setCurrentActivities([]);
    setCurrentSources([]);
    setCurrentChanges([]);

    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(
          (data.messages || []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          }))
        );
        setCurrentSources(data.evidence || []);
        setCurrentChanges(
          (data.observations || []).map((obs) => ({
            entityName: obs.entity_name || 'Entity',
            summary: `${obs.claim}: ${obs.value} (${obs.status})`,
            status: obs.status,
          }))
        );
      }
    } catch (err) {
      setErrorMessage('Failed to load conversation history.');
    }
  }

  async function deleteConversation(e, id) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this conversation?')) return;

    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversationId === id) {
          startNewChat();
        }
      }
    } catch (err) {
      console.warn('Failed to delete conversation:', err);
    }
  }

  function startNewChat() {
    if (isStreaming) return;
    setActiveConversationId(null);
    setMessages([]);
    setCurrentActivities([]);
    setCurrentSources([]);
    setCurrentChanges([]);
    setErrorMessage('');
  }

  async function handleSendMessage(promptText) {
    const textToSend = promptText || inputMessage;
    if (!textToSend.trim() || isStreaming) return;

    setInputMessage('');
    setErrorMessage('');
    setIsStreaming(true);
    setCurrentActivities([]);
    setCurrentSources([]);
    setCurrentChanges([]);

    // Add user message to UI immediately
    const tempUserMsg = {
      id: 'temp-user-' + Date.now(),
      role: 'user',
      content: textToSend,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Placeholder assistant message
    const tempAssistantId = 'temp-assistant-' + Date.now();
    let accumulatedContent = '';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConversationId || undefined,
          message: textToSend,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.message || `Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (!block.trim()) continue;

          let eventName = 'message';
          let dataStr = '';

          const parts = block.split('\n');
          for (const line of parts) {
            if (line.startsWith('event: ')) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6).trim();
            }
          }

          if (!dataStr) continue;
          let parsedData;
          try {
            parsedData = JSON.parse(dataStr);
          } catch (_) {
            continue;
          }

          if (eventName === 'status') {
            setCurrentActivities((prev) => [...prev, parsedData.message]);
          } else if (eventName === 'search_start') {
            setCurrentActivities((prev) => [
              ...prev,
              `Searching web: "${parsedData.query}" [${parsedData.callIndex}/${parsedData.maxCalls}]`,
            ]);
          } else if (eventName === 'sources') {
            setCurrentSources(parsedData || []);
          } else if (eventName === 'change_detection') {
            setCurrentChanges(parsedData || []);
          } else if (eventName === 'delta') {
            accumulatedContent += parsedData.text;
            setMessages((prev) => {
              const withoutTemp = prev.filter((m) => m.id !== tempAssistantId);
              return [
                ...withoutTemp,
                {
                  id: tempAssistantId,
                  role: 'assistant',
                  content: accumulatedContent,
                  createdAt: new Date().toISOString(),
                },
              ];
            });
          } else if (eventName === 'done') {
            if (parsedData.conversationId && !activeConversationId) {
              setActiveConversationId(parsedData.conversationId);
            }
            fetchConversations();
          } else if (eventName === 'error') {
            setErrorMessage(parsedData.message || 'An error occurred during response generation.');
          }
        }
      }
    } catch (err) {
      setErrorMessage(err.message || 'Connection failed.');
    } finally {
      setIsStreaming(false);
      setCurrentActivities([]);
    }
  }

  const EXAMPLE_PROMPTS = [
    {
      title: 'CRM Pricing & Product Updates',
      prompt: 'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
    },
    {
      title: 'Temporal Verification',
      prompt: 'What did I ask you on 3 November? Is your answer still correct today?',
    },
    {
      title: 'Postgres Hosting Price Check',
      prompt: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since?',
    },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '280px',
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="var(--accent-color)" />
            <h1 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Minimi AI</h1>
          </div>
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '4px',
            }}
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <button
          onClick={startNewChat}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            background: 'var(--accent-color)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 16px',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: '16px',
            transition: 'opacity 0.2s',
          }}
        >
          <Plus size={18} />
          New Research Chat
        </button>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            CONVERSATION HISTORY
          </div>
          {conversations.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '12px 0' }}>
              No previous conversations recorded yet.
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  marginBottom: '4px',
                  background: activeConversationId === conv.id ? 'var(--bg-card)' : 'transparent',
                  border: activeConversationId === conv.id ? '1px solid var(--border-color)' : '1px solid transparent',
                }}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{conv.title}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    {new Date(conv.updated_at).toLocaleDateString()} · {conv.message_count} msgs
                  </div>
                </div>
                <button
                  onClick={(e) => deleteConversation(e, conv.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '4px',
                    marginLeft: '8px',
                  }}
                  title="Delete conversation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <div>Memory: FTS5 + Episodic</div>
          <div>Search: Tavily API (Single Tool)</div>
          <div>Bounded: 4 calls / 2 rounds</div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        {/* Messages Container */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {messages.length === 0 ? (
            /* Empty State */
            <div style={{ maxWidth: '640px', margin: '40px auto', textAlign: 'center' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: 'var(--pill-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <Sparkles size={28} color="var(--accent-color)" />
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>
                AI Research & Memory Assistant
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '28px', lineHeight: 1.5 }}>
                Persistent multi-turn memory, deterministic temporal reasoning, and verified real-time web research
                grounded in live evidence.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Example Evaluation Scenarios:
                </div>
                {EXAMPLE_PROMPTS.map((ex, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSendMessage(ex.prompt)}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-color)')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '4px' }}>{ex.title}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>"{ex.prompt}"</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Messages List */
            <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isUser ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '85%',
                        padding: '14px 18px',
                        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        background: isUser ? 'var(--user-bubble)' : 'var(--assistant-bubble)',
                        color: isUser ? 'var(--user-text)' : 'var(--assistant-text)',
                        border: isUser ? 'none' : '1px solid var(--border-color)',
                        lineHeight: 1.6,
                        fontSize: '0.95rem',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })}

              {/* Live Activities & Changes */}
              {isStreaming && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                  {currentActivities.map((act, i) => (
                    <div key={i} className="activity-badge">
                      <RefreshCw size={14} className="animate-spin" />
                      <span>{act}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Change Detection Summary Cards */}
              {currentChanges.length > 0 && (
                <div
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '14px',
                    marginTop: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, marginBottom: '8px' }}>
                    <TrendingUp size={16} color="var(--accent-color)" />
                    <span>Change Detection Matrix</span>
                  </div>
                  {currentChanges.map((change, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: '0.85rem',
                        padding: '6px 0',
                        borderBottom: i < currentChanges.length - 1 ? '1px solid var(--border-color)' : 'none',
                      }}
                    >
                      <strong>{change.entityName}</strong>: {change.summary}
                    </div>
                  ))}
                </div>
              )}

              {/* Retrieved Sources Footnote */}
              {currentSources.length > 0 && (
                <div
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '14px',
                    marginTop: '12px',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    RETRIEVED CITATIONS & EVIDENCE
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {currentSources.map((src, i) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--accent-color)',
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>[{i + 1}]</span>
                        <span>{src.title}</span>
                        <ExternalLink size={12} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Error Message Alert */}
              {errorMessage && (
                <div
                  style={{
                    background: 'var(--badge-change)',
                    color: 'var(--badge-change-text)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.9rem',
                  }}
                >
                  <AlertCircle size={18} />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div
          style={{
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            padding: '16px 32px',
          }}
        >
          <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              placeholder="Ask a question, recall past conversations, or check for pricing updates..."
              disabled={isStreaming}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                outline: 'none',
              }}
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={isStreaming || !inputMessage.trim()}
              style={{
                background: 'var(--accent-color)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '0 20px',
                cursor: isStreaming || !inputMessage.trim() ? 'not-allowed' : 'pointer',
                opacity: isStreaming || !inputMessage.trim() ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
