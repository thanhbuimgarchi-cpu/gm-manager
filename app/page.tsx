"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type WorkRecord = {
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
};

type MonthFolder = {
  label: string;
  records: WorkRecord[];
};

type YearFolder = {
  year: number;
  months: MonthFolder[];
};

type DriveFolder = {
  label: string;
  icon: string;
  url: string;
};

const monthLabels = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
const buildMonths = (): MonthFolder[] => monthLabels.map((label) => ({ label, records: [] }));

const syncedDriveFolders: DriveFolder[] = [
  { label: "-DATA", icon: "◫", url: "https://drive.google.com/drive/folders/1KtXRW5p5tuY4qLC8q0hOG5dcKtnCfCu-" },
  { label: "Tư vấn", icon: "⌂", url: "https://drive.google.com/drive/folders/1Yab8uHBsD52C2MYsfAf3gMB5J6QCyqDt" },
  { label: "Thiết kế", icon: "▣", url: "https://drive.google.com/drive/folders/1DZ9x1xvDFj2C_1tgPw9hxXGWwxbgO7q5" },
  { label: "Dự toán", icon: "⌁", url: "https://drive.google.com/drive/folders/1loJbkEr_FT8iWf0Q4yFPKf6z4GmDJd9B" },
  { label: "Thi công", icon: "♧", url: "https://drive.google.com/drive/folders/1l8QbIOmsjUPxk7WSQP0rhvp9__I7fwyc" },
  { label: "Nghiệm thu", icon: "✓", url: "https://drive.google.com/drive/folders/1UtILAuZidLcluaheQDxGt4XXeUUa5rOr" },
  { label: "Bảo hành", icon: "⚙", url: "https://drive.google.com/drive/folders/1xPYkwM5i6tO9F_O5aPAAVKbtKecj6_U_" },
  { label: "Nhân lực", icon: "♙", url: "https://drive.google.com/drive/folders/1tQEoQPp38kinet7FzjVFF0-k6O7YJqcN" },
].filter((folder) => !folder.label.startsWith("-"));

const initialYears: YearFolder[] = [
  { year: 2024, months: buildMonths() },
  { year: 2025, months: buildMonths() },
  { year: 2026, months: buildMonths() },
];

const team = [
  ["SP", "Sandra Perry", "Product Manager", "lavender"],
  ["AC", "Antony Cardenas", "Sales Manager", "sand"],
  ["JC", "Jamal Connolly", "Growth Marketer", "rose"],
  ["CC", "Cara Cerr", "SEO Specialist", "sage"],
];

function getVietnamDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { day: value("day"), month: value("month"), year: value("year") };
}

function nameInitials(name: string) {
  const words = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[A-Za-z0-9]+/g);
  return (words?.map((word) => word.charAt(0)).join("").toUpperCase() || "KH").slice(0, 6);
}

function saveWorkspace(years: YearFolder[]) {
  window.localStorage.setItem("gm-manager-consulting", JSON.stringify(years));
}

export default function Home() {
  const now = getVietnamDate();
  const [activeFolder, setActiveFolder] = useState("Tư vấn");
  const [years, setYears] = useState<YearFolder[]>(initialYears);
  const [selectedYear, setSelectedYear] = useState(now.year);
  const [selectedMonth, setSelectedMonth] = useState(now.month);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [modalMonth, setModalMonth] = useState(now.month);
  const [modalYear, setModalYear] = useState(now.year);
  const [customerName, setCustomerName] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const currentDate = getVietnamDate();
    setSelectedYear(currentDate.year);
    setSelectedMonth(currentDate.month);
    setModalYear(currentDate.year);
    setModalMonth(currentDate.month);

    const savedWorkspace = window.localStorage.getItem("gm-manager-consulting");
    if (savedWorkspace) {
      try {
        setYears(JSON.parse(savedWorkspace) as YearFolder[]);
      } catch {
        window.localStorage.removeItem("gm-manager-consulting");
      }
    }
  }, []);

  const activeDriveFolder = syncedDriveFolders.find((folder) => folder.label === activeFolder);
  const activeYear = years.find((folder) => folder.year === selectedYear);
  const activeMonthFolder = activeYear?.months[selectedMonth - 1];
  const availableModalYears = useMemo(() => {
    const currentYear = getVietnamDate().year;
    return Array.from(new Set([...years.map((folder) => folder.year), ...Array.from({ length: 9 }, (_, index) => currentYear - 3 + index)])).sort((a, b) => a - b);
  }, [years]);
  const visibleRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    const records = activeMonthFolder?.records ?? [];
    return term ? records.filter((record) => `${record.name} ${record.projectId}`.toLowerCase().includes(term)) : records;
  }, [activeMonthFolder, search]);

  const persist = (nextYears: YearFolder[]) => {
    setYears(nextYears);
    saveWorkspace(nextYears);
  };

  const openAddDialog = () => {
    const currentDate = getVietnamDate();
    setModalMonth(currentDate.month);
    setModalYear(currentDate.year);
    setCustomerName("");
    setAddOpen(true);
  };

  const addCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = customerName.trim();
    const targetYear = years.find((folder) => folder.year === modalYear);
    if (!name) return;
    if (!targetYear) {
      setNotice(`Chưa có thư mục năm ${modalYear}. Hãy tạo thư mục năm này trên Drive trước.`);
      return;
    }

    const created = getVietnamDate();
    const projectId = `GM${String(created.day).padStart(2, "0")}${String(created.month).padStart(2, "0")}${created.year}${nameInitials(name)}`;
    const record: WorkRecord = {
      id: `${Date.now()}-${projectId}`,
      name,
      projectId,
      createdAt: `${String(created.day).padStart(2, "0")}/${String(created.month).padStart(2, "0")}/${created.year}`,
    };
    const nextYears = years.map((yearFolder) => yearFolder.year !== modalYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== modalMonth - 1 ? monthFolder : { ...monthFolder, records: [record, ...monthFolder.records] }),
    });
    persist(nextYears);
    setSelectedYear(modalYear);
    setSelectedMonth(modalMonth);
    setAddOpen(false);
    setNotice(`Đã tạo thư mục ${projectId} trong T${modalMonth}/${modalYear}`);
  };

  const deleteRecord = (id: string) => {
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : { ...monthFolder, records: monthFolder.records.filter((record) => record.id !== id) }),
    });
    persist(nextYears);
    setNotice("Đã xóa dữ liệu — danh sách được cập nhật ngay");
  };

  return (
    <main className="crm-shell">
      <aside className="sidebar">
        <div className="brand">GM<span>-CRM</span></div>
        <p className="sidebar-label sidebar-label--top">Quy trình công việc</p>
        <nav className="main-nav" aria-label="Quy trình GM-manager">
          {syncedDriveFolders.map((folder) => (
            <button key={folder.label} onClick={() => setActiveFolder(folder.label)} className={`nav-row ${activeFolder === folder.label ? "nav-row--active" : ""}`}>
              <span className="nav-row__icon">{folder.icon}</span>
              <span>{folder.label}</span>
              <span className="nav-row__drive">↗</span>
            </button>
          ))}
        </nav>

        <section className="members">
          <div className="members__heading"><p className="sidebar-label">Members</p><button aria-label="Invite member" className="plain-plus">+</button></div>
          {team.map(([initials, name, role, color]) => (
            <div className="member" key={name}>
              <span className={`avatar avatar--${color}`}>{initials}</span>
              <span><b>{name}</b><small>{role}</small></span>
            </div>
          ))}
          <div className="member member--you"><span className="avatar avatar--you">IR</span><span><b>Ilona Rollins</b><small>CRM Specialist</small></span><span className="logout">↪</span></div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer..." aria-label="Search customer" /></label>
          <div className="topbar__actions"><span className="drive-status"><i /> Đã nạp GM-manager</span><button className="add-button" onClick={openAddDialog}><span>＋</span> Add customer</button></div>
        </header>

        {activeFolder === "Tư vấn" ? (
          <section className="consulting-view">
            <div className="calendar-bar">
              <label>Tháng
                <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
                  {monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                </select>
              </label>
              <label>Năm
                <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
                  {years.map((folder) => <option key={folder.year} value={folder.year}>{folder.year}</option>)}
                </select>
              </label>
              <span className="calendar-bar__hint">Thư mục đang xem: <b>{activeMonthFolder?.label} / {selectedYear}</b></span>
              <a href={activeDriveFolder?.url} target="_blank" rel="noreferrer" className="drive-link">Mở thư mục Drive ↗</a>
            </div>

            <section className="month-workspace">
              <header className="month-workspace__heading">
                <div><p className="eyebrow">Tư vấn</p><h1>Thư mục {activeMonthFolder?.label} / {selectedYear}</h1></div>
                <span>{visibleRecords.length} thư mục dự án</span>
              </header>
              <div className="record-grid">
                {visibleRecords.length ? visibleRecords.map((record) => (
                  <article className="project-folder" key={record.id}>
                    <span className="project-folder__icon">▰</span>
                    <div><b>{record.projectId}</b><small>{record.name}</small><em>Khởi tạo {record.createdAt}</em></div>
                    <button onClick={() => deleteRecord(record.id)} aria-label={`Xóa ${record.projectId}`}>×</button>
                  </article>
                )) : <div className="empty-records"><span>▱</span><h2>Chưa có thư mục dự án</h2><p>Nhấn Add customer để tạo hồ sơ trong tháng đang chọn.</p><button onClick={openAddDialog}>Thêm hồ sơ đầu tiên</button></div>}
              </div>
            </section>
          </section>
        ) : (
          <section className="coming-soon">
            <span>{activeDriveFolder?.icon}</span><p className="eyebrow">GM-manager</p><h1>{activeFolder}</h1>
            <p>Khu vực này đã được liên kết với thư mục cùng tên trong GM-manager.</p><a href={activeDriveFolder?.url} target="_blank" rel="noreferrer" className="add-button">Mở trên Drive ↗</a>
          </section>
        )}
        {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      </section>

      {addOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setAddOpen(false)}>
          <form className="add-dialog" onSubmit={addCustomer} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setAddOpen(false)} aria-label="Đóng">×</button>
            <p className="eyebrow">Tạo thư mục dự án</p><h2>Add customer</h2>
            <label>Tháng<select value={modalMonth} onChange={(event) => setModalMonth(Number(event.target.value))}>{monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
            <label>Năm<select value={modalYear} onChange={(event) => setModalYear(Number(event.target.value))}>{availableModalYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
            <label>Tên khách hàng<input autoFocus value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Ví dụ: Lê Thanh K" /></label>
            <p className="id-preview">ID dự kiến: <b>GM{String(getVietnamDate().day).padStart(2, "0")}{String(getVietnamDate().month).padStart(2, "0")}{getVietnamDate().year}{customerName ? nameInitials(customerName) : "..."}</b></p>
            <button className="add-button" type="submit">Tạo thư mục</button>
          </form>
        </div>
      )}
    </main>
  );
}
