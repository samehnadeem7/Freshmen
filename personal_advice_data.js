/**
 * Personal Advice & Curated Wisdom Data
 * 
 * You can edit this file directly or use the Admin Login on the site to add/manage entries.
 */
const initialPersonalAdvice = [
    {
        id: "advice-character",
        title: "Build Character That Lasts Longer Than Your Degree",
        category: "Golden Quote",
        quote: "Your CGPA and job title are just tickets to enter rooms. How you treat people, whether you can be trusted in private, and your relationship with Allah and your brothers will define your real life.",
        details: "Focus on character development, humility, and keeping your word during your four years at VNIT.",
        url: "",
        date: "2026-10"
    },
    {
        id: "advice-niche",
        title: "Finding Your Niche vs Being a Generalist",
        category: "Career & Skills",
        quote: "Choosing a career to pursue is much more important than just getting placed anywhere. Pick one domain, go ridiculously deep into it for 6 months, and you will outcompete 95% of your batch.",
        details: "Explore different sectors in your 1st and 2nd year by connecting with 4th year seniors and alumni who are already working in industry.",
        url: "https://samehnadeem7.github.io/Freshmen/",
        date: "2026-10"
    },
    {
        id: "advice-embarrassment",
        title: "Embarrassment & Failure Are Underexplored Emotions",
        category: "Life Lesson",
        quote: "If you are never embarrassed, you are playing it too safe. Raise your hand in class, ask seniors questions, apply to opportunities you feel underqualified for, and start things that might fail.",
        details: "Confidence is not having all the answers—it is knowing that failure will build your resilience rather than destroy you.",
        url: "",
        date: "2026-10"
    }
];

if (typeof module !== 'undefined' && module.exports) {
    module.exports = initialPersonalAdvice;
}
