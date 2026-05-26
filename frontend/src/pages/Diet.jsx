import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCcw, Droplets } from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader, Card } from "../components/Shared";
import GuidanceCard from "../components/GuidanceCard";
import { http } from "../lib/api";
import { toast } from "sonner";

const Diet = () => {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [hyd, setHyd] = useState({ glasses: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([http.get("/diet/plan"), http.get("/hydration/today")]);
      setPlan(p.data); setHyd(h.data);
    } catch { toast.error("Could not load diet plan"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const regen = async (reason = "Regenerate full plan") => {
    setRegenerating(true);
    try { const { data } = await http.post("/diet/regenerate", { reason }); setPlan(data); toast.success("Plan refreshed."); }
    catch { toast.error("Could not regenerate"); }
    setRegenerating(false);
  };

  const regenMeal = async (day, mealName) => {
    const reason = window.prompt(`Why swap "${mealName}"?`, "I don't like this");
    if (reason === null) return;
    setRegenerating(true);
    try { const { data } = await http.post("/diet/regenerate", { reason, day, meal: mealName }); setPlan(data); toast.success("Swapped."); }
    catch { toast.error("Failed"); }
    setRegenerating(false);
  };

  const drink = async () => { await http.post("/hydration", { glasses: 1 }); setHyd(await (await http.get("/hydration/today")).data); };

  if (loading) return <AppShell><div className="p-10 text-white/40">Cooking up your plan…</div></AppShell>;

  return (
    <AppShell>
      <PageHeader
        eyebrow="diet & nutrition"
        title="Eat your way calmer."
        subtitle="A 7-day plan tuned to your body, allergies, and the moods you'd like to feel."
        accent="#14b8a6"
        right={
          <button onClick={() => regen()} disabled={regenerating} data-testid="diet-regen"
            className="px-5 py-2.5 rounded-full border border-teal-400/40 hover:bg-teal-500/10 flex items-center gap-2 disabled:opacity-50">
            <RefreshCcw size={14} /> {regenerating ? "..." : "regenerate"}
          </button>
        }
      />

      {/* Hydration */}
      <Card accent="#14b8a6" className="mb-5">
        <div className="flex items-center gap-5">
          <div className="relative w-20 h-28">
            <div className="absolute inset-0 rounded-2xl border-2 border-teal-400/40" />
            <motion.div className="absolute bottom-0 left-0 right-0 rounded-b-2xl bg-gradient-to-t from-teal-400 to-cyan-400"
              animate={{ height: `${Math.min(100, (hyd.glasses / 8) * 100)}%` }} transition={{ duration: 0.7 }} />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-widest text-teal-300">hydration</div>
            <div className="font-display text-3xl">{hyd.glasses || 0}<span className="text-base text-white/40"> / 8 glasses</span></div>
          </div>
          <button onClick={drink} data-testid="diet-water" className="px-5 py-2.5 rounded-full bg-white text-black flex items-center gap-2 hover:scale-[1.03] transition">
            <Droplets size={14} /> +1 glass
          </button>
        </div>
      </Card>

      <div className="mb-5">
        <GuidanceCard feature="diet" accent="#14b8a6" title="3 tips for your nutrition today" />
      </div>

      {/* Days */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {(plan?.days || []).map((d, i) => (
          <motion.div key={d.day} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="glass p-6">
            <div className="font-display text-2xl mb-4">{d.day}</div>
            <div className="space-y-3">
              {d.meals.map((m) => (
                <div key={m.name} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-teal-400/30 transition group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{m.emoji}</span>
                        <div>
                          <div className="text-[11px] uppercase tracking-widest text-teal-300">{m.time}</div>
                          <div className="text-base font-medium">{m.name}</div>
                        </div>
                      </div>
                      <div className="text-xs text-white/55 mt-2">{(m.ingredients || []).join(" · ")}</div>
                      <div className="text-xs text-teal-300 mt-1 italic">{m.benefit}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-lg">{m.calories}<span className="text-xs text-white/40"> cal</span></div>
                      <div className="text-[10px] text-white/40">P{m.macros?.protein} · C{m.macros?.carbs} · F{m.macros?.fat}</div>
                      <button onClick={() => regenMeal(d.day, m.name)} data-testid={`swap-${d.day}-${m.name}`}
                        className="mt-2 text-[10px] text-teal-300 opacity-0 group-hover:opacity-100 transition">swap</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </AppShell>
  );
};

export default Diet;
