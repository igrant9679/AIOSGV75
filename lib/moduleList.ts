/** The modules (rule 53): client-safe list. Each owns some pages; switching it off hides them. */
export interface ModuleDef { id: string; name: string; blurb: string; hrefs: string[]; duty?: string }

export const MODULES: ModuleDef[] = [
  { id: "levelup", name: "LevelUp", blurb: "Hand tasks and projects to the fleet from your planning app, approve them and review the results.", hrefs: ["/levelup"], duty: "Checking LevelUp every minute stops while it is off; hand-offs wait in LevelUp." },
  { id: "github", name: "GitHub", blurb: "Every repository on your GitHub accounts: what changed, what is waiting on you, a written report for each.", hrefs: ["/github"], duty: "The daily report stops while it is off (Work keeps the tasks it has)." },
  { id: "studio", name: "Studio and content", blurb: "Image, voice and video making, SEO drafts, and the builds shelf.", hrefs: ["/studio", "/content", "/builds", "/pipeline"] },
  { id: "arena", name: "Arena and evals", blurb: "Model battles and report cards.", hrefs: ["/arena", "/evals"] },
  { id: "jarvis", name: "JARVIS", blurb: "The voice command center.", hrefs: ["/jarvis"] },
  { id: "hermes", name: "Hermes Lab", blurb: "Goal mode and the Control Room for Hermes.", hrefs: ["/hermes-lab"] },
  { id: "knowledge", name: "Graph, journal and goals", blurb: "The knowledge map, the daily journal and checkbox goals.", hrefs: ["/graph", "/journal", "/goals"] },
];

/** Which module (if any) a page belongs to. */
export function moduleOfPath(pathname: string): ModuleDef | undefined {
  return MODULES.find((m) => m.hrefs.includes(pathname));
}
