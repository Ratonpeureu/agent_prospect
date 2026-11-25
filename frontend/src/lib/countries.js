export const COUNTRIES = [
  ["SN", "Sénégal"], ["CI", "Côte d'Ivoire"], ["ML", "Mali"], ["BF", "Burkina Faso"], ["NE", "Niger"],
  ["GN", "Guinée"], ["TG", "Togo"], ["BJ", "Bénin"], ["MR", "Mauritanie"], ["GM", "Gambie"],
  ["GW", "Guinée-Bissau"], ["CV", "Cap-Vert"], ["CM", "Cameroun"], ["GA", "Gabon"], ["CG", "Congo"],
  ["CD", "RD Congo"], ["TD", "Tchad"], ["CF", "Centrafrique"], ["GQ", "Guinée équatoriale"], ["DJ", "Djibouti"],
  ["KM", "Comores"], ["MG", "Madagascar"], ["MU", "Maurice"], ["SC", "Seychelles"], ["RW", "Rwanda"],
  ["BI", "Burundi"], ["MA", "Maroc"], ["DZ", "Algérie"], ["TN", "Tunisie"], ["EG", "Égypte"], ["LY", "Libye"],
  ["NG", "Nigeria"], ["GH", "Ghana"], ["LR", "Liberia"], ["SL", "Sierra Leone"], ["KE", "Kenya"],
  ["UG", "Ouganda"], ["TZ", "Tanzanie"], ["ET", "Éthiopie"], ["ZA", "Afrique du Sud"], ["AO", "Angola"],
  ["MZ", "Mozambique"], ["ZM", "Zambie"], ["ZW", "Zimbabwe"], ["NA", "Namibie"], ["BW", "Botswana"],
  ["FR", "France"], ["GB", "Royaume-Uni"], ["BE", "Belgique"], ["CH", "Suisse"], ["LU", "Luxembourg"],
  ["DE", "Allemagne"], ["ES", "Espagne"], ["IT", "Italie"], ["PT", "Portugal"], ["NL", "Pays-Bas"],
  ["CA", "Canada"], ["US", "États-Unis"],
];

const MAP = Object.fromEntries(COUNTRIES);
export const countryName = (code) => (code ? MAP[code] || code : "—");