/**
 * How to get your data out of UltiAnalytics. Shown on the Data page and copied verbatim into the
 * README (a test checks they match). Menu names checked against the UltiAnalytics source
 * (github.com/ultianalytics: UltimateIPhone, UltiAnalyticsWebApp) and the live site.
 */
export const UA_CSV_STEPS = [
  'In the UltiAnalytics app on your phone, open the Website tab and upload your games: turn on Game Uploading, or tap Upload, pick the games and tap Upload. Sign in with Google if it asks.',
  'On a computer (the Download page is turned off on phone-sized screens), open your team website: www.ultianalytics.com/app/#/<your team number>/players. The Website tab in the app links to it, or search for your team at www.ultianalytics.com.',
  'If the team website has a password, enter it.',
  'Click Download in the menu bar, then click "Download raw statistics in CSV format". You get one file (e.g. PortAuthority-stats.csv) with every game.',
  'In this app, open Data > Import from UltiAnalytics, click Choose file and pick that CSV (or paste its contents). Review the games and players, then click Import.',
]

export const UA_LINK_STEPS = [
  'Copy your team website link (or just the long number in it) and paste it into the team link box here, then click Load team.',
  'This only works when the team website has no password. It reads the games straight from UltiAnalytics and includes exact mid-point subs, which the CSV does not have.',
]
