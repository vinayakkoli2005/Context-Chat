import React, { useEffect, useState } from 'react';

type SkillSummary = {
  id: string;
  name: string;
  description: string;
  category: 'writing' | 'coding' | 'analysis' | 'productivity';
};

const CATEGORY_LABELS: Record<SkillSummary['category'], string> = {
  writing: 'Writing',
  coding: 'Coding',
  analysis: 'Analysis',
  productivity: 'Productivity'
};

const CATEGORY_COLORS: Record<SkillSummary['category'], string> = {
  writing: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  coding: 'bg-green-500/20 text-green-300 border-green-500/30',
  analysis: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  productivity: 'bg-orange-500/20 text-orange-300 border-orange-500/30'
};

const Skills: React.FC = () => {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const [list, active] = await Promise.all([
      window.cc.invoke(window.cc.channels.SKILL_LIST) as Promise<SkillSummary[]>,
      window.cc.invoke(window.cc.channels.SKILL_GET_ACTIVE) as Promise<string | null>
    ]);
    setSkills(list);
    setActiveId(active);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleApply = async (id: string) => {
    if (id === activeId) {
      await window.cc.invoke(window.cc.channels.SKILL_CLEAR);
      setActiveId(null);
    } else {
      await window.cc.invoke(window.cc.channels.SKILL_APPLY, id);
      setActiveId(id);
    }
  };

  if (loading) {
    return <div className="p-6 text-white/50 text-sm">Loading skills…</div>;
  }

  const byCategory = skills.reduce<Record<string, SkillSummary[]>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {});

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">Skills</h2>
        <p className="text-xs text-white/50">
          Skills are focused instructions that boost small models on specific tasks.
          {activeId
            ? <> Active skill is applied to every chat until you clear it.</>
            : <> No skill is currently active — pick one to apply it to all new chats.</>}
        </p>
      </div>

      {activeId && (
        <div className="mb-4 p-3 bg-blue-900/30 border border-blue-500/30 rounded flex justify-between items-center">
          <div className="text-sm">
            <span className="text-white/60">Active skill:</span>{' '}
            <span className="font-medium">{skills.find(s => s.id === activeId)?.name}</span>
          </div>
          <button
            onClick={() => handleApply(activeId)}
            className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded"
          >
            Clear
          </button>
        </div>
      )}

      {Object.entries(byCategory).map(([cat, group]) => (
        <section key={cat} className="mb-6">
          <h3 className="text-sm font-semibold mb-3 text-white/70">
            {CATEGORY_LABELS[cat as SkillSummary['category']]}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {group.map(s => {
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  onClick={() => handleApply(s.id)}
                  className={`text-left p-4 rounded border transition-colors ${
                    isActive
                      ? 'border-blue-500 bg-blue-900/30'
                      : 'border-white/10 bg-gray-800 hover:bg-gray-700 hover:border-white/20'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-medium text-sm">{s.name}</div>
                    <span className={`px-2 py-0.5 rounded text-[10px] border ${CATEGORY_COLORS[s.category]}`}>
                      {CATEGORY_LABELS[s.category]}
                    </span>
                  </div>
                  <div className="text-xs text-white/50 leading-relaxed">{s.description}</div>
                  {isActive && (
                    <div className="mt-2 text-[10px] text-blue-300">✓ Currently active</div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};

export default Skills;
