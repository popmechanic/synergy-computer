import React, { useState, useEffect, useRef } from "react";
import { useFireproofClerk } from "use-fireproof";

const PERSONALITY_TYPES = [
  { code: "INTJ", name: "Architect", desc: "Strategic, independent thinker" },
  { code: "INTP", name: "Logician", desc: "Innovative, curious analyst" },
  { code: "ENTJ", name: "Commander", desc: "Bold, strategic leader" },
  { code: "ENTP", name: "Debater", desc: "Smart, curious explorer" },
  { code: "INFJ", name: "Advocate", desc: "Quiet, mystical idealist" },
  { code: "INFP", name: "Mediator", desc: "Poetic, kind healer" },
  { code: "ENFJ", name: "Protagonist", desc: "Charismatic, inspiring leader" },
  { code: "ENFP", name: "Campaigner", desc: "Enthusiastic, creative free spirit" },
  { code: "ISTJ", name: "Logistician", desc: "Practical, fact-minded realist" },
  { code: "ISFJ", name: "Defender", desc: "Dedicated, warm protector" },
  { code: "ESTJ", name: "Executive", desc: "Decisive, organized leader" },
  { code: "ESFJ", name: "Consul", desc: "Caring, social connector" },
  { code: "ISTP", name: "Virtuoso", desc: "Bold, practical experimenter" },
  { code: "ISFP", name: "Adventurer", desc: "Flexible, charming artist" },
  { code: "ESTP", name: "Entrepreneur", desc: "Smart, energetic perceiver" },
  { code: "ESFP", name: "Entertainer", desc: "Spontaneous, energetic performer" },
];

// Parse SWOT text into bullet points
function parseInsights(text) {
  if (!text) return [];
  // Split by sentences or line breaks, filter empty
  return text
    .split(/[.!?]\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 10)
    .slice(0, 4);
}

// Generate deterministic ID for analysis (same pairing = same doc)
function makeAnalysisId(type1, type2) {
  const sorted = [type1, type2].sort();
  return `analysis-${sorted[0]}-${sorted[1]}`;
}

// Generate display name for pairing
function makePairingName(type1, type2) {
  return `${type1} + ${type2}`;
}

export default function App() {
  const { database, useLiveQuery, useDocument } = useFireproofClerk("synergy-db");
  const { callAI, loading: aiLoading } = useAI();

  // Active selection document - tracks which analysis is currently viewed
  const { doc: active, merge: mergeActive, save: saveActive } = useDocument({
    _id: "active",
    type: "active",
    analysisId: null,
    person1Type: "",
    person2Type: ""
  });

  // Query all saved analyses
  const { docs: savedAnalyses } = useLiveQuery("type", { key: "analysis" });

  // Sort by lastViewedAt (most recent first)
  const sortedAnalyses = [...savedAnalyses].sort((a, b) =>
    (b.lastViewedAt || 0) - (a.lastViewedAt || 0)
  );

  // Get the currently active analysis document
  const activeAnalysis = savedAnalyses.find(a => a._id === active.analysisId);

  // Chat input
  const { doc: chatInput, merge: mergeChatInput, reset: resetChatInput } = useDocument({
    content: "",
    type: "draft"
  });

  // Chat messages
  const { docs: messages } = useLiveQuery("type", { key: "message" });
  const sortedMessages = [...messages].sort((a, b) =>
    (a.createdAt || 0) - (b.createdAt || 0)
  );

  const [generating, setGenerating] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const chatEndRef = useRef(null);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sortedMessages.length]);

  const hasTypes = active.person1Type && active.person2Type;
  const canGenerateSWOT = hasTypes && !activeAnalysis;
  const hasSWOT = activeAnalysis && activeAnalysis.strengths;

  const generateSWOT = async () => {
    if (!hasTypes) return;
    setGenerating(true);

    const type1 = PERSONALITY_TYPES.find(t => t.code === active.person1Type);
    const type2 = PERSONALITY_TYPES.find(t => t.code === active.person2Type);

    const prompt = `You are a relationship psychology expert analyzing Myers-Briggs personality compatibility.

Person 1: ${active.person1Type} (${type1?.name} - ${type1?.desc})
Person 2: ${active.person2Type} (${type2?.name} - ${type2?.desc})

Provide a SWOT analysis for this couple's relationship dynamics. Be specific, insightful, and actionable. Format your response EXACTLY as follows (include the headers):

STRENGTHS:
[2-3 paragraphs about what naturally works well between these types]

WEAKNESSES:
[2-3 paragraphs about where they'll naturally clash or struggle]

OPPORTUNITIES:
[2-3 paragraphs about growth potential and how they can help each other evolve]

THREATS:
[2-3 paragraphs about what could break them apart if not addressed]`;

    try {
      const response = await callAI({
        model: "anthropic/claude-sonnet-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 2000
      });

      const text = response.choices[0].message.content;

      // Parse the response
      const parseSection = (header) => {
        const regex = new RegExp(`${header}:\\s*([\\s\\S]*?)(?=(?:STRENGTHS|WEAKNESSES|OPPORTUNITIES|THREATS):|$)`, 'i');
        const match = text.match(regex);
        return match ? match[1].trim() : "";
      };

      // Create/update analysis document with deterministic ID
      const analysisId = makeAnalysisId(active.person1Type, active.person2Type);
      const now = Date.now();

      await database.put({
        _id: analysisId,
        type: "analysis",
        person1Type: active.person1Type,
        person2Type: active.person2Type,
        pairingName: makePairingName(active.person1Type, active.person2Type),
        strengths: parseSection("STRENGTHS"),
        weaknesses: parseSection("WEAKNESSES"),
        opportunities: parseSection("OPPORTUNITIES"),
        threats: parseSection("THREATS"),
        generatedAt: now,
        lastViewedAt: now
      });

      // Set as active analysis
      mergeActive({ analysisId });
      await saveActive();
    } catch (err) {
      console.error("SWOT generation failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  // Load a saved analysis
  const loadAnalysis = async (analysis) => {
    mergeActive({
      analysisId: analysis._id,
      person1Type: analysis.person1Type,
      person2Type: analysis.person2Type
    });
    await saveActive();

    // Update lastViewedAt
    await database.put({
      ...analysis,
      lastViewedAt: Date.now()
    });

    setShowChat(false);
  };

  // Delete a saved analysis
  const deleteAnalysis = async (analysisId, e) => {
    e.stopPropagation();
    await database.del(analysisId);

    // If deleted analysis was active, clear active selection
    if (active.analysisId === analysisId) {
      mergeActive({ analysisId: null, person1Type: "", person2Type: "" });
      await saveActive();
      setShowChat(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.content.trim() || aiLoading || !activeAnalysis) return;

    const userContent = chatInput.content.trim();
    resetChatInput();

    // Save user message
    await database.put({
      type: "message",
      role: "user",
      content: userContent,
      createdAt: Date.now()
    });

    const type1 = PERSONALITY_TYPES.find(t => t.code === activeAnalysis.person1Type);
    const type2 = PERSONALITY_TYPES.find(t => t.code === activeAnalysis.person2Type);

    const systemPrompt = `You are a compassionate relationship advisor with deep expertise in Myers-Briggs personality dynamics.

You're helping a couple understand their relationship:
- Person 1: ${activeAnalysis.person1Type} (${type1?.name} - ${type1?.desc})
- Person 2: ${activeAnalysis.person2Type} (${type2?.name} - ${type2?.desc})

Their SWOT analysis revealed:
- Strengths: ${activeAnalysis.strengths?.substring(0, 300)}...
- Key challenges: ${activeAnalysis.weaknesses?.substring(0, 300)}...

Provide warm, practical advice that acknowledges both perspectives. Be specific about how each personality type experiences situations. Offer concrete suggestions they can try today.`;

    const conversationHistory = sortedMessages.slice(-10).map(m => ({
      role: m.role,
      content: m.content
    }));

    try {
      const response = await callAI({
        model: "anthropic/claude-sonnet-4",
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationHistory,
          { role: "user", content: userContent }
        ],
        temperature: 0.8,
        max_tokens: 1000
      });

      const aiContent = response.choices[0].message.content;

      await database.put({
        type: "message",
        role: "assistant",
        content: aiContent,
        createdAt: Date.now()
      });
    } catch (err) {
      console.error("Chat error:", err);
      await database.put({
        type: "message",
        role: "assistant",
        content: "I'm sorry, I encountered an error. Please try again.",
        createdAt: Date.now()
      });
    }
  };

  const resetAll = async () => {
    // Clear chat messages
    for (const msg of messages) {
      await database.del(msg._id);
    }
    // Clear active selection (but keep saved analyses)
    mergeActive({ analysisId: null, person1Type: "", person2Type: "" });
    await saveActive();
    setShowChat(false);
  };

  return (
    <>
      <style>{`
        :root {
            --bg-main: #E3DDD3;
            --bg-alt: #DAD3C9;
            --bg-darker: #D1C9BE;
            --border: #C4BBB0;
            --border-dashed: #B0A79E;
            --text-main: #1F1C18;
            --text-secondary: #59524B;
            --accent-blue: #4A72D4;
            --accent-red: #C23B2B;
            --accent-olive: #B5C061;
            --accent-gold: #EBD581;
            --accent-dark: #6E6662;
            --accent-slate: #5F5955;
            --font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            --space-xs: 4px;
            --space-s: 12px;
            --space-m: 24px;
            --space-l: 40px;
            --space-xl: 80px;
        }

        /* Force light theme */
        html, body, #container, #container > div {
            background-color: var(--bg-main) !important;
        }

        .synergy-app * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        .synergy-app {
            font-family: var(--font-family);
            background-color: var(--bg-main);
            color: var(--text-main);
            height: 100vh;
            overflow: hidden;
            display: flex;
            font-feature-settings: "ss01", "ss02";
        }

        .pattern-bg {
            background-image:
                radial-gradient(circle at 50% 50%, transparent 35%, rgba(0,0,0,0.06) 36%, rgba(0,0,0,0.06) 55%, transparent 56%),
                radial-gradient(circle at 0% 0%, transparent 35%, rgba(0,0,0,0.06) 36%, rgba(0,0,0,0.06) 55%, transparent 56%),
                radial-gradient(circle at 100% 0%, transparent 35%, rgba(0,0,0,0.06) 36%, rgba(0,0,0,0.06) 55%, transparent 56%),
                radial-gradient(circle at 0% 100%, transparent 35%, rgba(0,0,0,0.06) 36%, rgba(0,0,0,0.06) 55%, transparent 56%),
                radial-gradient(circle at 100% 100%, transparent 35%, rgba(0,0,0,0.06) 36%, rgba(0,0,0,0.06) 55%, transparent 56%);
            background-size: 24px 24px;
        }

        .app-container {
            display: flex;
            width: 100%;
            height: 100%;
        }

        .sidebar {
            width: 380px;
            min-width: 380px;
            background-color: var(--bg-main);
            border-right: 1px solid var(--border);
            padding: var(--space-l);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow-y: auto;
        }

        .brand-block {
            margin-bottom: var(--space-xl);
        }

        .synergy-app h1 {
            font-size: 64px;
            font-weight: 500;
            letter-spacing: -1.5px;
            line-height: 1;
            margin-bottom: var(--space-m);
            color: var(--text-main);
        }

        .description {
            font-size: 14px;
            line-height: 1.5;
            color: var(--text-main);
            max-width: 280px;
        }

        .input-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-m);
            margin-bottom: auto;
        }

        .field {
            position: relative;
        }

        .field label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: var(--space-s);
            color: var(--text-main);
        }

        .select-wrapper {
            position: relative;
        }

        .synergy-app select {
            width: 100%;
            appearance: none;
            background: transparent;
            border: none;
            border-bottom: 1px solid var(--text-main);
            font-family: var(--font-family);
            font-size: 20px;
            padding: 8px 0;
            border-radius: 0;
            color: var(--text-main);
            cursor: pointer;
        }

        .synergy-app select:focus {
            outline: none;
            border-color: var(--accent-blue);
        }

        .select-arrow {
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            pointer-events: none;
            font-size: 10px;
        }

        .saved-analyses {
            margin-top: var(--space-l);
            border-top: 1px dashed var(--border-dashed);
            padding-top: var(--space-m);
        }

        .saved-analyses-header {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            margin-bottom: var(--space-s);
        }

        .saved-analyses-list {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .saved-analysis-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.15s ease;
            font-size: 14px;
        }

        .saved-analysis-item:hover {
            background-color: var(--bg-alt);
        }

        .saved-analysis-item.active {
            background-color: var(--bg-darker);
            font-weight: 500;
        }

        .saved-analysis-item .pairing-name {
            flex: 1;
        }

        .saved-analysis-item .delete-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            font-size: 18px;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
            opacity: 0;
            transition: opacity 0.15s ease, color 0.15s ease;
        }

        .saved-analysis-item:hover .delete-btn {
            opacity: 1;
        }

        .saved-analysis-item .delete-btn:hover {
            color: var(--accent-red);
        }

        .actions {
            margin-top: var(--space-l);
            display: flex;
            align-items: center;
            gap: var(--space-m);
        }

        .submit-btn {
            background-color: var(--accent-blue);
            color: white;
            border: none;
            width: 64px;
            height: 64px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s ease;
        }

        .submit-btn:hover:not(:disabled) {
            transform: scale(1.05);
        }

        .submit-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .submit-label {
            font-size: 24px;
            font-weight: 400;
            letter-spacing: -0.5px;
        }

        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            position: relative;
        }

        .dashboard-header {
            height: 80px;
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 var(--space-m);
            background: var(--bg-main);
        }

        .report-meta {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .reset-btn {
            font-size: 12px;
            font-weight: 500;
            color: var(--text-secondary);
            background: transparent;
            border: 1px solid var(--border);
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .reset-btn:hover {
            border-color: var(--text-main);
            color: var(--text-main);
        }

        .swot-grid {
            flex: 1;
            display: flex;
            width: 100%;
            height: 100%;
        }

        .swot-column {
            flex: 1;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--border);
            position: relative;
            transition: background-color 0.3s ease;
        }

        .swot-column:last-child {
            border-right: none;
        }

        .swot-column:nth-child(odd) { background-color: var(--bg-main); }
        .swot-column:nth-child(even) { background-color: var(--bg-alt); }

        .swot-header {
            padding: var(--space-m);
        }

        .swot-label {
            font-size: 12px;
            font-weight: 500;
            margin-bottom: var(--space-xs);
            color: var(--text-main);
        }

        .swot-score {
            font-size: 32px;
            font-weight: 500;
            letter-spacing: -1px;
            margin-bottom: var(--space-s);
        }

        .swot-body {
            padding: 0 var(--space-m);
            flex: 1;
        }

        .insight-list {
            list-style: none;
        }

        .insight-item {
            font-size: 13px;
            line-height: 1.6;
            margin-bottom: var(--space-s);
            position: relative;
            padding-left: 12px;
        }

        .insight-item::before {
            content: "•";
            position: absolute;
            left: 0;
            color: var(--text-secondary);
        }

        .pattern-anchor {
            height: 120px;
            width: 100%;
            margin-top: auto;
            position: relative;
            border-top: 1px dashed rgba(0,0,0,0.15);
        }

        .col-strengths .pattern-anchor { background-color: var(--accent-olive); height: 35%; }
        .col-weaknesses .pattern-anchor { background-color: var(--accent-red); height: 25%; }
        .col-opportunities .pattern-anchor { background-color: var(--accent-gold); height: 45%; }
        .col-threats .pattern-anchor { background-color: var(--accent-dark); height: 20%; }

        .chat-teaser {
            position: absolute;
            bottom: var(--space-m);
            right: var(--space-m);
            width: 320px;
            background: #fff;
            border: 1px solid var(--border);
            box-shadow: 0 4px 24px rgba(0,0,0,0.05);
            padding: var(--space-m);
            z-index: 10;
            background-color: var(--bg-main);
        }

        .chat-teaser h3 {
            font-size: 16px;
            font-weight: 500;
            margin-bottom: var(--space-s);
        }

        .chat-input-fake {
            border-bottom: 1px solid var(--text-main);
            padding-bottom: 8px;
            font-size: 14px;
            color: var(--text-secondary);
            margin-top: var(--space-m);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }

        .lock-icon {
            font-size: 12px;
            opacity: 0.5;
        }

        /* Chat panel styles */
        .chat-panel {
            position: absolute;
            bottom: var(--space-m);
            right: var(--space-m);
            width: 400px;
            max-height: 500px;
            background-color: var(--bg-main);
            border: 1px solid var(--border);
            box-shadow: 0 4px 24px rgba(0,0,0,0.1);
            z-index: 20;
            display: flex;
            flex-direction: column;
        }

        .chat-header {
            padding: var(--space-m);
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .chat-header h3 {
            font-size: 16px;
            font-weight: 500;
        }

        .close-btn {
            background: transparent;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: var(--text-secondary);
        }

        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-m);
            max-height: 300px;
        }

        .chat-message {
            margin-bottom: var(--space-m);
        }

        .chat-message.user {
            text-align: right;
        }

        .chat-message .bubble {
            display: inline-block;
            max-width: 80%;
            padding: var(--space-s);
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.5;
        }

        .chat-message.user .bubble {
            background-color: var(--accent-blue);
            color: white;
        }

        .chat-message.assistant .bubble {
            background-color: var(--bg-alt);
            color: var(--text-main);
        }

        .chat-form {
            padding: var(--space-m);
            border-top: 1px solid var(--border);
            display: flex;
            gap: var(--space-s);
        }

        .chat-form input {
            flex: 1;
            border: none;
            border-bottom: 1px solid var(--text-main);
            background: transparent;
            font-family: var(--font-family);
            font-size: 14px;
            padding: 8px 0;
        }

        .chat-form input:focus {
            outline: none;
            border-color: var(--accent-blue);
        }

        .chat-form button {
            background-color: var(--accent-blue);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-family: var(--font-family);
            font-weight: 500;
        }

        .chat-form button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .typing-indicator {
            display: flex;
            gap: 4px;
            padding: var(--space-s);
        }

        .typing-indicator span {
            width: 8px;
            height: 8px;
            background-color: var(--text-secondary);
            border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out;
        }

        .typing-indicator span:nth-child(1) { animation-delay: 0s; }
        .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
        .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes bounce {
            0%, 80%, 100% { transform: translateY(0); }
            40% { transform: translateY(-6px); }
        }

        svg.arrow {
            width: 24px;
            height: 24px;
            fill: none;
            stroke: white;
            stroke-width: 2;
        }

        .empty-state {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-secondary);
            font-size: 14px;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .spin {
            animation: spin 1s linear infinite;
        }

        @media (max-width: 1024px) {
            .sidebar { width: 300px; min-width: 300px; }
            .synergy-app h1 { font-size: 48px; }
        }

        @media (max-width: 800px) {
            .app-container { flex-direction: column; overflow-y: auto; }
            .sidebar { width: 100%; min-width: 0; height: auto; padding: var(--space-m); }
            .swot-grid { flex-direction: column; height: auto; }
            .swot-column { border-right: none; border-bottom: 1px solid var(--border); min-height: 200px; }
            .pattern-anchor { height: 60px !important; }
            .chat-teaser, .chat-panel { position: relative; width: 100%; right: auto; bottom: auto; margin: var(--space-m); width: auto; }
        }
      `}</style>

      <div className="synergy-app">
        <div className="app-container">
          {/* Sidebar */}
          <aside className="sidebar">
            <div>
              <div className="brand-block">
                <h1>Synergy</h1>
                <p className="description">
                  Understand how you connect, where you clash, and what makes your relationship thrive. Powered by personality science and AI.
                </p>
              </div>

              <div className="input-group">
                <div className="field">
                  <label>YOUR TYPE</label>
                  <div className="select-wrapper">
                    <select
                      value={active.person1Type}
                      onChange={async (e) => {
                        const newType = e.target.value;
                        // Check if this pairing already exists
                        const existingId = active.person2Type
                          ? makeAnalysisId(newType, active.person2Type)
                          : null;
                        const existing = existingId ? savedAnalyses.find(a => a._id === existingId) : null;
                        mergeActive({
                          person1Type: newType,
                          analysisId: existing ? existingId : null
                        });
                        await saveActive();
                      }}
                    >
                      <option value="">Select your type...</option>
                      {PERSONALITY_TYPES.map(type => (
                        <option key={type.code} value={type.code}>
                          {type.code} - {type.name}
                        </option>
                      ))}
                    </select>
                    <span className="select-arrow">▼</span>
                  </div>
                </div>

                <div className="field">
                  <label>PARTNER TYPE</label>
                  <div className="select-wrapper">
                    <select
                      value={active.person2Type}
                      onChange={async (e) => {
                        const newType = e.target.value;
                        // Check if this pairing already exists
                        const existingId = active.person1Type
                          ? makeAnalysisId(active.person1Type, newType)
                          : null;
                        const existing = existingId ? savedAnalyses.find(a => a._id === existingId) : null;
                        mergeActive({
                          person2Type: newType,
                          analysisId: existing ? existingId : null
                        });
                        await saveActive();
                      }}
                    >
                      <option value="">Select partner's type...</option>
                      {PERSONALITY_TYPES.map(type => (
                        <option key={type.code} value={type.code}>
                          {type.code} - {type.name}
                        </option>
                      ))}
                    </select>
                    <span className="select-arrow">▼</span>
                  </div>
                </div>
              </div>

              {/* Saved Analyses List */}
              {sortedAnalyses.length > 0 && (
                <div className="saved-analyses">
                  <div className="saved-analyses-header">Saved Analyses</div>
                  <ul className="saved-analyses-list">
                    {sortedAnalyses.map(analysis => (
                      <li
                        key={analysis._id}
                        className={`saved-analysis-item ${active.analysisId === analysis._id ? 'active' : ''}`}
                        onClick={() => loadAnalysis(analysis)}
                      >
                        <span className="pairing-name">{analysis.pairingName}</span>
                        <button
                          className="delete-btn"
                          onClick={(e) => deleteAnalysis(analysis._id, e)}
                          title="Delete analysis"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="actions">
              <button
                className="submit-btn"
                onClick={generateSWOT}
                disabled={!canGenerateSWOT || generating}
              >
                {generating ? (
                  <svg className="arrow spin" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" />
                  </svg>
                ) : (
                  <svg className="arrow" viewBox="0 0 24 24">
                    <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <span className="submit-label">{generating ? "Analyzing..." : "Analyze"}</span>
            </div>
          </aside>

          {/* Main Content */}
          <main className="main-content">
            <header className="dashboard-header">
              <span className="report-meta">
                {activeAnalysis ? `Report: ${activeAnalysis.pairingName}` : hasTypes ? `Report: ${active.person1Type} + ${active.person2Type}` : "Select types to begin"}
              </span>
              {hasSWOT && (
                <button className="reset-btn" onClick={resetAll}>Start Over</button>
              )}
            </header>

            {hasSWOT ? (
              <div className="swot-grid">
                {/* Strengths */}
                <div className="swot-column col-strengths">
                  <div className="swot-header">
                    <div className="swot-label">Strengths</div>
                    <div className="swot-score">What works</div>
                    <ul className="insight-list">
                      {parseInsights(activeAnalysis.strengths).map((insight, i) => (
                        <li key={i} className="insight-item">{insight}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="pattern-anchor pattern-bg" />
                </div>

                {/* Weaknesses */}
                <div className="swot-column col-weaknesses">
                  <div className="swot-header">
                    <div className="swot-label">Weaknesses</div>
                    <div className="swot-score">Watch for</div>
                    <ul className="insight-list">
                      {parseInsights(activeAnalysis.weaknesses).map((insight, i) => (
                        <li key={i} className="insight-item">{insight}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="pattern-anchor pattern-bg" />
                </div>

                {/* Opportunities */}
                <div className="swot-column col-opportunities">
                  <div className="swot-header">
                    <div className="swot-label">Opportunities</div>
                    <div className="swot-score">Grow together</div>
                    <ul className="insight-list">
                      {parseInsights(activeAnalysis.opportunities).map((insight, i) => (
                        <li key={i} className="insight-item">{insight}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="pattern-anchor pattern-bg" />
                </div>

                {/* Threats */}
                <div className="swot-column col-threats">
                  <div className="swot-header">
                    <div className="swot-label">Threats</div>
                    <div className="swot-score">Stay aware</div>
                    <ul className="insight-list">
                      {parseInsights(activeAnalysis.threats).map((insight, i) => (
                        <li key={i} className="insight-item">{insight}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="pattern-anchor pattern-bg" />
                </div>
              </div>
            ) : (
              <div className="empty-state">
                {hasTypes ? "Ready to analyze your dynamic" : "Select both personality types to begin"}
              </div>
            )}

            {/* Chat Teaser (locked) */}
            {hasSWOT && !showChat && (
              <div className="chat-teaser" onClick={() => setShowChat(true)}>
                <h3>Ask a Follow-Up Question</h3>
                <p className="description" style={{ fontSize: "13px" }}>
                  Dig deeper into your dynamic. Ask anything about how your types interact.
                </p>
                <div className="chat-input-fake">
                  <span>"Why do we fight about money?"</span>
                  <span className="lock-icon">→</span>
                </div>
              </div>
            )}

            {/* Chat Panel (unlocked) */}
            {showChat && (
              <div className="chat-panel">
                <div className="chat-header">
                  <h3>Ask About Your Relationship</h3>
                  <button className="close-btn" onClick={() => setShowChat(false)}>×</button>
                </div>
                <div className="chat-messages">
                  {sortedMessages.length === 0 && activeAnalysis && (
                    <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
                      Ask anything about your {activeAnalysis.pairingName} dynamic...
                    </p>
                  )}
                  {sortedMessages.map((msg) => (
                    <div key={msg._id} className={`chat-message ${msg.role}`}>
                      <div className="bubble">{msg.content}</div>
                    </div>
                  ))}
                  {aiLoading && (
                    <div className="chat-message assistant">
                      <div className="typing-indicator">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <form className="chat-form" onSubmit={sendMessage}>
                  <input
                    type="text"
                    value={chatInput.content}
                    onChange={(e) => mergeChatInput({ content: e.target.value })}
                    placeholder="Ask a question..."
                    disabled={aiLoading}
                  />
                  <button type="submit" disabled={!chatInput.content.trim() || aiLoading}>
                    Send
                  </button>
                </form>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
