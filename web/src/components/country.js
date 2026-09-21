// Derive country from a phone number's calling code (longest-prefix match).
// Each entry: [flag, Arabic name, English name].
const CODES = {
  "1": ["🇺🇸", "أمريكا/كندا", "USA/Canada"],
  "20": ["🇪🇬", "مصر", "Egypt"],
  "212": ["🇲🇦", "المغرب", "Morocco"], "213": ["🇩🇿", "الجزائر", "Algeria"], "216": ["🇹🇳", "تونس", "Tunisia"],
  "218": ["🇱🇾", "ليبيا", "Libya"], "220": ["🇬🇲", "غامبيا", "Gambia"], "221": ["🇸🇳", "السنغال", "Senegal"],
  "222": ["🇲🇷", "موريتانيا", "Mauritania"], "234": ["🇳🇬", "نيجيريا", "Nigeria"], "249": ["🇸🇩", "السودان", "Sudan"],
  "252": ["🇸🇴", "الصومال", "Somalia"], "254": ["🇰🇪", "كينيا", "Kenya"],
  "27": ["🇿🇦", "جنوب أفريقيا", "South Africa"],
  "33": ["🇫🇷", "فرنسا", "France"], "34": ["🇪🇸", "إسبانيا", "Spain"], "39": ["🇮🇹", "إيطاليا", "Italy"],
  "44": ["🇬🇧", "بريطانيا", "UK"], "49": ["🇩🇪", "ألمانيا", "Germany"],
  "60": ["🇲🇾", "ماليزيا", "Malaysia"], "62": ["🇮🇩", "إندونيسيا", "Indonesia"], "63": ["🇵🇭", "الفلبين", "Philippines"],
  "7": ["🇷🇺", "روسيا", "Russia"], "90": ["🇹🇷", "تركيا", "Türkiye"], "91": ["🇮🇳", "الهند", "India"],
  "92": ["🇵🇰", "باكستان", "Pakistan"], "93": ["🇦🇫", "أفغانستان", "Afghanistan"], "98": ["🇮🇷", "إيران", "Iran"],
  "961": ["🇱🇧", "لبنان", "Lebanon"], "962": ["🇯🇴", "الأردن", "Jordan"], "963": ["🇸🇾", "سوريا", "Syria"],
  "964": ["🇮🇶", "العراق", "Iraq"], "965": ["🇰🇼", "الكويت", "Kuwait"], "966": ["🇸🇦", "السعودية", "Saudi Arabia"],
  "967": ["🇾🇪", "اليمن", "Yemen"], "968": ["🇴🇲", "عُمان", "Oman"], "970": ["🇵🇸", "فلسطين", "Palestine"],
  "971": ["🇦🇪", "الإمارات", "UAE"], "972": ["🇮🇱", "فلسطين المحتلة", "Palestine (occupied)"], "973": ["🇧🇭", "البحرين", "Bahrain"],
  "974": ["🇶🇦", "قطر", "Qatar"], "975": ["🇧🇹", "بوتان", "Bhutan"], "976": ["🇲🇳", "منغوليا", "Mongolia"],
};

export function countryFromPhone(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, "").replace(/^0+/, "");
  for (const len of [3, 2, 1]) {
    const p = d.slice(0, len);
    if (CODES[p]) return { code: p, flag: CODES[p][0], name: CODES[p][1], nameEn: CODES[p][2] };
  }
  return null;
}

// "🇸🇦 السعودية" / "🇸🇦 Saudi Arabia" or fallback to the stored value / dash.
export function countryLabel(phone, fallback, lang = "ar") {
  const c = countryFromPhone(phone);
  if (c) return `${c.flag} ${lang === "en" ? c.nameEn : c.name}`;
  return fallback || "—";
}

export default countryFromPhone;
