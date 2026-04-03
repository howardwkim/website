import { Icons } from "@/components/icons";
import { HomeIcon, NotebookIcon } from "lucide-react";
import { ReactLight } from "@/components/ui/svgs/reactLight";
import { NextjsIconDark } from "@/components/ui/svgs/nextjsIconDark";
import { Typescript } from "@/components/ui/svgs/typescript";
import { Nodejs } from "@/components/ui/svgs/nodejs";
import { Python } from "@/components/ui/svgs/python";
import { Postgresql } from "@/components/ui/svgs/postgresql";
import { Docker } from "@/components/ui/svgs/docker";

export const DATA = {
  name: "Howard Kim",
  initials: "HK",
  url: "https://howardwkim.com",
  location: "Seattle, WA",
  locationLink: "https://www.google.com/maps/place/seattle",
  description:
    "Full-stack engineer, founder, and builder. I turn messy problems into clean systems.",
  summary:
    "I'm a full-stack engineer with an [MBA from UCLA Anderson](/#education) and an [MS in Computer Science (ML) from Georgia Tech](/#education). I co-founded [Mementum](/#projects), where I invented NFC jewelry for embedding digital memories and scaled the business to $750K in revenue. Currently I build data tools for ocean science at [Simons CMAP](/#work), where I've shipped 24 production releases and optimized catalog search 16x. I care about solving the right problem, not just the stated one.",
  avatarUrl: "/me.png",
  skills: [
    { name: "React", icon: ReactLight },
    { name: "Next.js", icon: NextjsIconDark },
    { name: "TypeScript", icon: Typescript },
    { name: "Node.js", icon: Nodejs },
    { name: "Python", icon: Python },
    { name: "PostgreSQL", icon: Postgresql },
    { name: "Docker", icon: Docker },
    { name: "Flutter", icon: undefined },
    { name: "Redux", icon: undefined },
    { name: "TailwindCSS", icon: undefined },
    { name: "AWS", icon: undefined },
    { name: "GCP", icon: undefined },
  ],
  navbar: [
    { href: "/", icon: HomeIcon, label: "Home" },
    { href: "/blog", icon: NotebookIcon, label: "Blog" },
  ],
  contact: {
    email: "howardwkim@gmail.com",
    tel: "+14156362102",
    social: {
      GitHub: {
        name: "GitHub",
        url: "https://github.com/howardwkim",
        icon: Icons.github,
        navbar: true,
      },
      LinkedIn: {
        name: "LinkedIn",
        url: "https://linkedin.com/in/howardwaynekim",
        icon: Icons.linkedin,
        navbar: true,
      },
      email: {
        name: "Send Email",
        url: "mailto:howardwkim@gmail.com",
        icon: Icons.email,
        navbar: false,
      },
    },
  },

  work: [
    {
      company: "Simons CMAP",
      href: "https://simonscmap.com",
      badges: [],
      location: "Remote",
      title: "Full-Stack Software Engineer / CTO",
      logoUrl: "",
      start: "April 2025",
      end: "Present",
      description:
        "Architected and delivered Collections management system from scratch (12,000+ lines production code). Designed multi-dataset bulk download system reducing researcher workflow time by 80%. Optimized catalog search 16x (800ms to 50ms). Led architectural migration from Redux monolith to feature-based structure. Eliminated 10,000+ lines of technical debt. 24 production releases at 1.5/week velocity.",
    },
    {
      company: "Freelance / Fractional CTO",
      href: "",
      badges: [],
      location: "Seattle, WA",
      title: "Fractional CTO & Consultant",
      logoUrl: "",
      start: "December 2022",
      end: "February 2025",
      description:
        "Consulted for multiple clients on technology strategy and implementation. Diagnosed organizational process problems beyond stated technical requirements. Automated workflows reducing admin workload 33% for an HR/vehicle compliance startup. Trained non-technical staff to use AI for UX iteration, saving $15K in dev costs. Generated consulting revenue with zero outbound marketing.",
    },
    {
      company: "Mementum",
      badges: [],
      href: "",
      location: "Seattle, WA",
      title: "Sr. Full-Stack Software Engineer / CTO & Co-Founder",
      logoUrl: "",
      start: "May 2018",
      end: "December 2023",
      description:
        "Invented scannable NFC jewelry for embedding digital memories. Built Flutter mobile app end-to-end from prototype to app stores. Designed Next.js e-commerce site reducing page load time by 57%. Migrated business logic to serverless cloud functions (+63% backend velocity). Automated build/deployment reducing release time by 89%. Scaled business to $750K revenue in 18 months.",
    },
    {
      company: "Blend Labs",
      badges: [],
      href: "https://blend.com",
      location: "San Francisco, CA",
      title: "Software Engineer, Application Logic",
      logoUrl: "",
      start: "September 2017",
      end: "May 2018",
      description:
        "Implemented support for 3+ borrowers, enabling 100% customer migration to the platform. Refactored Cypress E2E tests, reducing runtime by 9%.",
    },
  ],
  education: [
    {
      school: "Georgia Institute of Technology",
      href: "https://gatech.edu",
      degree: "Master of Science, Computer Science (Machine Learning)",
      logoUrl: "",
      start: "2014",
      end: "2016",
    },
    {
      school: "UCLA Anderson School of Management",
      href: "https://anderson.ucla.edu",
      degree: "Master of Business Administration",
      logoUrl: "",
      start: "2012",
      end: "2014",
    },
  ],
  projects: [
    {
      title: "Simons CMAP",
      href: "https://simonscmap.com",
      dates: "April 2025 - Present",
      active: true,
      description:
        "Open-access data portal for ocean, atmosphere, and climate science. Built the Collections system, bulk download pipeline, and modernized the frontend architecture.",
      technologies: [
        "React",
        "Redux",
        "Node.js",
        "MS SQL Server",
        "AG Grid",
        "Material-UI",
        "Docker",
      ],
      links: [
        {
          type: "Website",
          href: "https://simonscmap.com",
          icon: <Icons.globe className="size-3" />,
        },
      ],
      image: "",
      video: "",
    },
    {
      title: "Mementum",
      href: "",
      dates: "May 2018 - December 2023",
      active: false,
      description:
        "NFC jewelry that lets you embed and share digital memories with a tap. Built the full tech stack: Flutter mobile app, Next.js e-commerce site, serverless backend, and manufacturing pipeline.",
      technologies: [
        "Flutter",
        "Dart",
        "Next.js",
        "TypeScript",
        "Firebase",
        "Cloud Functions",
        "Stripe",
      ],
      links: [],
      image: "",
      video: "",
    },
  ],
  hackathons: [] as readonly {
    title: string;
    dates: string;
    location: string;
    description: string;
    image?: string;
    mlh?: string;
    win?: string;
    icon?: string;
    links: readonly { title: string; icon: React.ReactElement; href: string }[];
  }[],
} as const;
