/** One-time Google setup, shown in Settings and copied verbatim in the README. */
export const CODE_URL = 'https://github.com/jakepmurray/port-authority-stats/blob/main/apps-script/Code.gs'

export const SETUP_STEPS: string[] = [
  'Create a new Google Sheet in your own Google account (sheets.new) and name it, e.g. "Port Authority Stats".',
  'In the Sheet, click Extensions > Apps Script.',
  'Delete the sample code in Code.gs, paste in all of apps-script/Code.gs from the repo (on GitHub, use the “Copy raw file” button), and click Save (the disk icon).',
  'In the function menu at the top, pick setup and click Run. When Google asks, click Review permissions and pick your account. If you see "Google hasn’t verified this app", click Advanced > Go to (your project name) (unsafe), then Allow. It is your own script.',
  'The Execution log at the bottom shows your admin key (a long string of letters and numbers). Copy it now; it is shown only once. If you lose it, run rotateToken the same way.',
  'Click Deploy > New deployment. Click the gear next to "Select type" and choose Web app. Set Execute as: Me and Who has access: Anyone. Click Deploy and authorize again if asked.',
  'Copy the Web app URL. It ends in /exec.',
  'Back in the Sheet, click File > Share > Publish to web. Open "Published content and settings", untick "Entire document", tick only Player Stats, Game Stats and Events, then click Publish and OK. Anyone with that link can read those three tabs; Players, Games, Points and Meta stay private.',
  'In this app, open Settings, paste the URL and the key into Your key, click Save, then click Test connection. It should say "Connected as admin". Then click Sync now.',
]

export const REDEPLOY_STEPS: string[] = [
  'Paste the new Code.gs over the old one in the Apps Script editor and click Save.',
  'Click Deploy > Manage deployments, select the active Web app deployment, and click Edit (the pencil).',
  'Under Version, choose New version, then click Deploy. The /exec URL stays the same, so nothing changes in the app.',
  'Don’t use Deploy > New deployment for updates: that creates a new URL.',
]
