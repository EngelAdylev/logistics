import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../api';

const WELCOME_MSG = {
  role: 'bot',
  text: 'Здравствуйте! Я ассистент поддержки системы дислокации. Задайте вопрос — отвечу на основе документации.',
  sources: [],
};

export default function ChatPage() {
  const [messages, setMessages] = useState([WELCOME_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentOnline, setAgentOnline] = useState(null);
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  // Проверяем доступность агента при монтировании
  useEffect(() => {
    api.get('/support/health')
      .then((r) => setAgentOnline(r.data.status === 'ok'))
      .catch(() => setAgentOnline(false));
  }, []);

  // Автоскролл вниз
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post('/support/ask', { text });
      const data = res.data;
      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text: data.answer || 'Нет ответа.',
          sources: data.sources || [],
          found: data.found,
        },
      ]);
    } catch (e) {
      const detail = e.response?.data?.detail;
      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text: detail || 'Ошибка соединения с ассистентом. Проверьте, что support_agent запущен.',
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-page">
      <div className="chat-header">
        <Bot size={20} />
        <span className="chat-header-title">Ассистент поддержки</span>
        <span className="chat-header-subtitle">на базе Ollama / Qwen2.5</span>
        {agentOnline !== null && (
          <span className={`chat-status ${agentOnline ? 'chat-status--online' : 'chat-status--offline'}`}>
            {agentOnline ? 'онлайн' : 'офлайн'}
          </span>
        )}
      </div>

      <div className="chat-messages" ref={chatRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg chat-msg--${msg.role}`}>
            <div className="chat-msg-avatar">
              {msg.role === 'bot' ? <Bot size={18} /> : <User size={18} />}
            </div>
            <div className={`chat-msg-content ${msg.isError ? 'chat-msg-content--error' : ''}`}>
              <div className="chat-msg-text">{msg.text}</div>
              {msg.sources?.length > 0 && (
                <div className="chat-msg-sources">
                  Источник: {msg.sources.join(', ')}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-msg chat-msg--bot">
            <div className="chat-msg-avatar">
              <Bot size={18} />
            </div>
            <div className="chat-msg-content chat-msg-content--typing">
              <Loader2 size={16} className="spin" />
              <span>Ищу в документации...</span>
            </div>
          </div>
        )}
      </div>

      {agentOnline === false && (
        <div className="chat-offline-banner">
          <AlertCircle size={16} />
          <span>Ассистент поддержки недоступен. Убедитесь, что support_agent запущен.</span>
        </div>
      )}

      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Введите вопрос..."
          disabled={loading}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          title="Отправить"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
