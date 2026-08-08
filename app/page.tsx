"use client";

import { useMemo, useState } from "react";

type Customer = {
  name: string;
  description: string;
  date: string;
  comments: number;
  attachments: number;
  tone?: "dark";
};

type PipelineColumn = {
  title: string;
  count: number;
  customers: Customer[];
};

const pipeline: PipelineColumn[] = [
  {
    title: "Contacted",
    count: 12,
    customers: [
      { name: "ByteBridge", description: "Corporate and personal data protection app", date: "18 Apr", comments: 2, attachments: 1 },
      { name: "AI Synergy", description: "Innovative solutions based on artificial intelligence", date: "21 Mar", comments: 1, attachments: 3 },
      { name: "LeadBoost Agency", description: "Lead attraction and automation for small businesses", date: "No due date", comments: 4, attachments: 7 },
    ],
  },
  {
    title: "Negotiation",
    count: 17,
    customers: [
      { name: "SkillUp Hub", description: "Platform for professional development of specialists", date: "09 Mar", comments: 4, attachments: 1 },
      { name: "Thera Well", description: "Platform for psychological support and consultations", date: "No due date", comments: 7, attachments: 2 },
      { name: "SwiftCargo", description: "International transportation of chemical goods", date: "23 Apr", comments: 2, attachments: 5 },
    ],
  },
  {
    title: "Offer Sent",
    count: 13,
    customers: [
      { name: "FitLife Nutrition", description: "Nutritious food and training plans for individuals", date: "10 Mar", comments: 1, attachments: 3 },
      { name: "Prime Estate", description: "Agency-developer of low-rise elite and comfort-class real estate", date: "16 Apr", comments: 1, attachments: 1, tone: "dark" },
      { name: "NextGen University", description: "Education with a practical first approach", date: "No due date", comments: 2, attachments: 0 },
    ],
  },
  {
    title: "Deal Closed",
    count: 12,
    customers: [
      { name: "CloudSphere", description: "Cloud services for data storage and computing", date: "24 Mar", comments: 2, attachments: 1 },
      { name: "Advantage Media", description: "Full cycle of digital advertising and social media promotion", date: "05 Apr", comments: 1, attachments: 3 },
      { name: "Safebank Solutions", description: "Innovative financial technologies and digital payments", date: "30 Mar", comments: 4, attachments: 7 },
    ],
  },
];

const menuItems: Array<[icon: string, label: string, count?: string, active?: boolean]> = [
  ["⌂", "Dashboard"],
  ["▣", "Tasks", "2"],
  ["⌁", "Activity"],
  ["♧", "Customers", "", true],
  ["⚙", "Settings"],
];

const projectItems = [
  ["ϟ", "BizConnect", "7"],
  ["⌁", "Growth Hub"],
  ["✿", "Conversion Path"],
  ["♜", "Marketing"],
];

const team = [
  ["SP", "Sandra Perry", "Product Manager", "lavender"],
  ["AC", "Antony Cardenas", "Sales Manager", "sand"],
  ["JC", "Jamal Connolly", "Growth Marketer", "rose"],
  ["CC", "Cara Cerr", "SEO Specialist", "sage"],
];

function Card({ customer }: { customer: Customer }) {
  return (
    <article className={`customer-card ${customer.tone === "dark" ? "customer-card--dark" : ""}`}>
      <div className="customer-card__top">
        <h3>{customer.name}</h3>
        <button aria-label={`More actions for ${customer.name}`} className="icon-button icon-button--small">⋮</button>
      </div>
      <p>{customer.description}</p>
      {customer.tone === "dark" && (
        <div className="customer-card__contact">
          <span>◉&nbsp; 5400 South Blvd, Miami, FL</span>
          <span>✉&nbsp; contact@primeestate.com</span>
          <span><b>AC</b> Antony Cardenas</span>
        </div>
      )}
      <div className="customer-card__meta">
        <span className="due-date">▣&nbsp; {customer.date}</span>
        <span className="meta-numbers">◌ {customer.comments}&nbsp;&nbsp;↗ {customer.attachments}</span>
      </div>
    </article>
  );
}

export default function Home() {
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("All customers");
  const [notice, setNotice] = useState("");

  const shownPipeline = useMemo(() => {
    const phrase = search.trim().toLowerCase();
    if (!phrase) return pipeline;

    return pipeline.map((column) => ({
      ...column,
      customers: column.customers.filter((customer) =>
        `${customer.name} ${customer.description}`.toLowerCase().includes(phrase),
      ),
    }));
  }, [search]);

  const addCustomer = () => {
    setNotice("New customer draft created");
    window.setTimeout(() => setNotice(""), 2600);
  };

  return (
    <main className="crm-shell">
      <aside className="sidebar">
        <div className="brand">Orbit<span>CRM</span></div>

        <nav className="main-nav" aria-label="Main navigation">
          {menuItems.map(([icon, label, count, active]) => (
            <button key={label} className={`nav-row ${active ? "nav-row--active" : ""}`}>
              <span className="nav-row__icon">{icon}</span>
              <span>{label}</span>
              {count && <small>{count}</small>}
            </button>
          ))}
        </nav>

        <section className="sidebar-section">
          <p className="sidebar-label">Projects</p>
          {projectItems.map(([icon, label, count]) => (
            <button key={label} className="nav-row">
              <span className="nav-row__icon">{icon}</span>
              <span>{label}</span>
              {count && <small>{count}</small>}
            </button>
          ))}
        </section>

        <section className="members">
          <div className="members__heading"><p className="sidebar-label">Members</p><button aria-label="Invite member" className="plain-plus">+</button></div>
          {team.map(([initials, name, role, color]) => (
            <div className="member" key={name}>
              <span className={`avatar avatar--${color}`}>{initials}</span>
              <span><b>{name}</b><small>{role}</small></span>
            </div>
          ))}
          <div className="member member--you">
            <span className="avatar avatar--you">IR</span>
            <span><b>Ilona Rollins</b><small>CRM Specialist</small></span>
            <span className="logout">↪</span>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search-box">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer..." aria-label="Search customers" />
          </label>
          <div className="topbar__actions">
            <button className="utility-button">≡&nbsp; Sort by</button>
            <div className="filter-wrap">
              <button className={`utility-button ${filterOpen ? "utility-button--active" : ""}`} onClick={() => setFilterOpen(!filterOpen)}>☷&nbsp; Filters</button>
              {filterOpen && (
                <div className="filter-menu">
                  {["All customers", "My customers", "Due this week"].map((item) => (
                    <button key={item} onClick={() => { setFilter(item); setFilterOpen(false); }}>{filter === item && "✓ "}{item}</button>
                  ))}
                </div>
              )}
            </div>
            <button className="utility-button profile-button">♙&nbsp; Me</button>
            <button className="add-button" onClick={addCustomer}><span>＋</span> Add customer</button>
          </div>
        </header>

        <section className="overview" aria-label="CRM summary">
          <div className="new-customers">
            <p className="eyebrow">New customers</p>
            <div className="bar-chart" aria-label="New customers from Monday to Friday">
              {[6, 8, 7, 3, 8].map((height, index) => <div className="bar-chart__item" key={index}><i style={{ height: `${height * 7}px` }} /><small>{["Mon", "Tue", "Wed", "Thu", "Fri"][index]}</small></div>)}
            </div>
          </div>
          <div className="goal-chart">
            <div className="radial-chart"><div><strong>68%</strong><small>Successful deals</small></div></div>
          </div>
          <div className="metric"><strong>53</strong><span>Tasks<br />in progress</span><b>→</b></div>
          <div className="metric"><strong>$15.890</strong><span>Prepayments<br />from customers</span><b>→</b></div>
        </section>

        <section className="pipeline" aria-label="Customer pipeline">
          <div className="pipeline__caption">
            <p>{filter}</p>
            {notice && <span role="status" className="toast">{notice}</span>}
          </div>
          <div className="pipeline__board">
            {shownPipeline.map((column) => (
              <section className="pipeline-column" key={column.title}>
                <header className="column-heading">
                  <h2>{column.title}</h2>
                  <span>{column.count} ↕</span>
                </header>
                <div className="card-stack">
                  {column.customers.map((customer) => <Card customer={customer} key={customer.name} />)}
                  {column.customers.length === 0 && <p className="empty-state">No customers found</p>}
                </div>
              </section>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
