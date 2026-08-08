"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";

type WorkRecord = {
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
  details: Record<string, string>;
  functionalRows: FunctionalRow[];
};

type FunctionalRow = {
  id: string;
  floor: string;
  room: string;
  quantity: string;
  description: string;
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

type DetailField = {
  code: string;
  label: string;
  options?: readonly string[];
};

const detailSections: Array<{ title: string; fields: DetailField[] }> = [
  {
    title: "1. Thông tin chủ đầu tư",
    fields: [
      { code: "HVT", label: "Họ và tên" },
      { code: "NS", label: "Ngày tháng năm sinh" },
      { code: "DC", label: "Địa chỉ" },
      { code: "SDT", label: "Số điện thoại/Zalo" },
      { code: "EMA", label: "Email" },
    ],
  },
  {
    title: "2. Thông tin nhu cầu",
    fields: [
      { code: "NCT-KT", label: "Nhu cầu thiết kế kiến trúc" },
      { code: "NCT-NT", label: "Nhu cầu thiết kế nội thất" },
      { code: "NCC-KT", label: "Nhu cầu thi công kiến trúc" },
      { code: "NCC-NT", label: "Nhu cầu thi công nội thất" },
      { code: "PC-KT", label: "Phong cách kiến trúc" },
      { code: "PC-NT", label: "Phong cách nội thất" },
      { code: "QCTC", label: "Quy cách thi công", options: ["Cải tạo", "Xây mới"] },
    ],
  },
  {
    title: "3. Thông tin thửa đất",
    fields: [
      { code: "QM", label: "Quy mô", options: ["Nhà lô", "Biệt thự", "Shophouse", "Kinh doanh", "Chung cư", "Dinh thự", "Tòa nhà"] },
      { code: "VTR", label: "Vị trí công trình" },
      { code: "HNH", label: "Hướng nhà", options: ["Đông", "Tây", "Nam", "Bắc", "Đông Bắc", "Đông Nam", "Tây Bắc", "Tây Nam"] },
      { code: "DTD", label: "Diện tích đất" },
      { code: "DTX", label: "Diện tích xây dựng" },
      { code: "VTMD", label: "Vị trí so với mặt đường" },
    ],
  },
];

const systemFields: DetailField[] = [
  { code: "D", label: "Điện" },
  { code: "N", label: "Nước" },
  { code: "E", label: "Năng lượng" },
  { code: "EL", label: "Thang máy" },
  { code: "DR", label: "Cửa" },
];

const roomOptions = ["Phòng khách", "Phòng ngủ", "Phòng bếp", "Gara", "Sân trước", "Sân sau", "Giếng trời", "Phòng thay đồ", "WC", "Sân phơi", "Sân thượng", "Phòng thờ", "Thang bộ", "Thang máy", "Phòng sinh hoạt chung", "Phòng xem phim", "Phòng xông hơi", "Phòng làm việc", "Phòng học", "Khu vực kinh doanh", "Phòng kho", "Phòng ngủ master", "WC master", "Phòng giúp việc"];

const createFunctionalRow = (floor = "Tầng 1"): FunctionalRow => ({ id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, floor, room: "", quantity: "", description: "" });

const normalizeSearchText = (value: string) => value
  .toLocaleLowerCase("vi")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replaceAll("đ", "d")
  .trim();

const getRoomSuggestions = (query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2 || query.trim().startsWith("@")) return [];

  return roomOptions
    .map((room, index) => {
      const normalizedRoom = normalizeSearchText(room);
      const matches = normalizedRoom.includes(normalizedQuery) || normalizedQuery.split(/\s+/).every((word) => normalizedRoom.includes(word));
      const score = normalizedRoom.startsWith(normalizedQuery) ? 0 : normalizedRoom.includes(normalizedQuery) ? 1 : 2;
      return { room, index, matches, score };
    })
    .filter((result) => result.matches)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 8)
    .map((result) => result.room);
};

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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [protectedAction, setProtectedAction] = useState<{ type: "rename" | "delete"; record: WorkRecord } | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renameUnlocked, setRenameUnlocked] = useState(false);
  const [roomSuggestionFor, setRoomSuggestionFor] = useState<string | null>(null);

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
      details: {},
      functionalRows: [createFunctionalRow()],
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

  const selectedRecord = activeMonthFolder?.records.find((record) => record.id === selectedRecordId) ?? null;

  const startProtectedAction = (type: "rename" | "delete", record: WorkRecord) => {
    setOpenMenuId(null);
    setProtectedAction({ type, record });
    setAccessCode("");
    setRenameValue(record.name);
    setRenameUnlocked(false);
  };

  const confirmAccessCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!protectedAction) return;
    if (accessCode !== "010101") {
      setNotice("Khóa không đúng");
      return;
    }
    if (protectedAction.type === "delete") {
      deleteRecord(protectedAction.record.id);
      setProtectedAction(null);
      setNotice(`Đã xóa ${protectedAction.record.projectId}`);
      return;
    }
    setRenameUnlocked(true);
  };

  const renameRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!protectedAction || !renameValue.trim()) return;
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : {
        ...monthFolder,
        records: monthFolder.records.map((record) => record.id === protectedAction.record.id ? { ...record, name: renameValue.trim() } : record),
      }),
    });
    persist(nextYears);
    setProtectedAction(null);
    setNotice("Đã đổi tên hồ sơ");
  };

  const updateRecordDetail = (key: string, value: string) => {
    if (!selectedRecord) return;
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : {
        ...monthFolder,
        records: monthFolder.records.map((record) => record.id === selectedRecord.id ? { ...record, details: { ...(record.details ?? {}), [key]: value } } : record),
      }),
    });
    persist(nextYears);
  };

  const functionalRows = selectedRecord?.functionalRows?.length ? selectedRecord.functionalRows : [createFunctionalRow()];

  const updateFunctionalRows = (nextRows: FunctionalRow[]) => {
    if (!selectedRecord) return;
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : {
        ...monthFolder,
        records: monthFolder.records.map((record) => record.id === selectedRecord.id ? { ...record, functionalRows: nextRows } : record),
      }),
    });
    persist(nextYears);
  };

  const updateFunctionalRow = (id: string, key: keyof Omit<FunctionalRow, "id">, value: string) => {
    updateFunctionalRows(functionalRows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  };

  const addFunctionalRow = () => {
    updateFunctionalRows([...functionalRows, createFunctionalRow(functionalRows[functionalRows.length - 1]?.floor || "Tầng 1")]);
  };

  const removeFunctionalRow = (id: string) => {
    if (functionalRows.length === 1) return;
    updateFunctionalRows(functionalRows.filter((row) => row.id !== id));
  };

  const validateRoom = (id: string, value: string) => {
    const input = value.trim();
    if (!input) return;
    if (input.startsWith("@")) {
      return;
    }
    const match = roomOptions.find((room) => room.toLocaleLowerCase("vi").replaceAll(" ", "") === input.toLocaleLowerCase("vi").replaceAll(" ", ""));
    updateFunctionalRow(id, "room", match ?? "");
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
                  <article className="project-folder" key={record.id} onClick={() => setSelectedRecordId(record.id)}>
                    <span className="project-folder__icon">▰</span>
                    <div><b>{record.projectId}</b><small>{record.name}</small><em>Khởi tạo {record.createdAt}</em></div>
                    <div className="project-actions">
                      <button className="more-button" onClick={(event) => { event.stopPropagation(); setOpenMenuId(openMenuId === record.id ? null : record.id); }} aria-label={`Tùy chọn ${record.projectId}`}>…</button>
                      {openMenuId === record.id && (
                        <div className="project-menu" onClick={(event) => event.stopPropagation()}>
                          <button onClick={() => startProtectedAction("rename", record)}>Rename</button>
                          <button className="project-menu__delete" onClick={() => startProtectedAction("delete", record)}>Delete</button>
                        </div>
                      )}
                    </div>
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

      {protectedAction && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setProtectedAction(null)}>
          {!renameUnlocked ? (
            <form className="security-dialog" onSubmit={confirmAccessCode} onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={() => setProtectedAction(null)} aria-label="Đóng">×</button>
              <p className="eyebrow">{protectedAction.type === "delete" ? "Delete" : "Rename"} · {protectedAction.record.projectId}</p>
              <h2>Nhập khóa bảo vệ</h2>
              <label>Khóa truy cập<input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoFocus placeholder="••••••" /></label>
              <button className="add-button" type="submit">Xác nhận</button>
            </form>
          ) : (
            <form className="security-dialog" onSubmit={renameRecord} onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={() => setProtectedAction(null)} aria-label="Đóng">×</button>
              <p className="eyebrow">{protectedAction.record.projectId}</p>
              <h2>Rename hồ sơ</h2>
              <label>Tên khách hàng<input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus /></label>
              <button className="add-button" type="submit">Lưu tên mới</button>
            </form>
          )}
        </div>
      )}

      {selectedRecord && (
        <div className="detail-backdrop" role="presentation" onMouseDown={() => setSelectedRecordId(null)}>
          <section className="record-detail" onMouseDown={(event) => event.stopPropagation()}>
            <header className="record-detail__heading">
              <div><p className="eyebrow">Hồ sơ dự án</p><h2>{selectedRecord.projectId}</h2><span>{selectedRecord.name}</span></div>
              <button className="dialog-close" onClick={() => setSelectedRecordId(null)} aria-label="Đóng">×</button>
            </header>
            <div className="detail-scroll">
              <table className="information-table">
                <thead><tr><th>Nội dung</th><th>Kết quả thu thập</th></tr></thead>
                <tbody>
                  {detailSections.map((section) => (
                    <Fragment key={section.title}>
                      <tr className="information-table__section"><th colSpan={2}>{section.title}</th></tr>
                      {section.fields.map((field) => (
                        <tr key={field.code}>
                          <td>{field.label} <span className="field-code">({field.code})</span></td>
                          <td>{field.options ? (
                            <select aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(event) => updateRecordDetail(field.code, event.target.value)}>
                              <option value="">Chọn giá trị</option>
                              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : <input aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(event) => updateRecordDetail(field.code, event.target.value)} placeholder="Nhập kết quả thu thập" />}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>

              <section className="dynamic-information">
                <h3>4. Thông tin công năng</h3>
                <p>Gõ tối thiểu 2 ký tự để xem gợi ý gần đúng, hoặc bắt đầu bằng <b>@</b> để nhập phòng mới.</p>
                <table className="functional-table">
                  <thead><tr><th>Tầng</th><th>Công năng</th><th>Số lượng</th><th>Mô tả chi tiết</th></tr></thead>
                  <tbody>
                    {functionalRows.map((row) => (
                      <tr key={row.id}>
                        <td><div className="floor-cell"><input value={row.floor} onChange={(event) => updateFunctionalRow(row.id, "floor", event.target.value)} /><span><button type="button" onClick={addFunctionalRow} aria-label="Thêm hàng">+</button><button type="button" onClick={() => removeFunctionalRow(row.id)} disabled={functionalRows.length === 1} aria-label="Xóa hàng">−</button></span></div></td>
                        <td>
                          <div className="room-autocomplete">
                            <input
                              value={row.room}
                              onChange={(event) => { updateFunctionalRow(row.id, "room", event.target.value); setRoomSuggestionFor(row.id); }}
                              onBlur={(event) => { window.setTimeout(() => setRoomSuggestionFor(null), 120); validateRoom(row.id, event.target.value); }}
                              onKeyDown={(event) => { if (event.key === "Escape") setRoomSuggestionFor(null); }}
                              placeholder="Gõ để tìm hoặc @Phòng mới"
                              aria-autocomplete="list"
                              aria-expanded={roomSuggestionFor === row.id && getRoomSuggestions(row.room).length > 0}
                            />
                            {roomSuggestionFor === row.id && getRoomSuggestions(row.room).length > 0 && (
                              <div className="room-suggestions" role="listbox" aria-label="Gợi ý công năng">
                                {getRoomSuggestions(row.room).map((room) => (
                                  <button key={room} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { updateFunctionalRow(row.id, "room", room); setRoomSuggestionFor(null); }}>
                                    {room}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td><input inputMode="numeric" value={row.quantity} onChange={(event) => updateFunctionalRow(row.id, "quantity", event.target.value)} placeholder="0" /></td>
                        <td><input value={row.description} onChange={(event) => updateFunctionalRow(row.id, "description", event.target.value)} placeholder="Nhập mô tả" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="dynamic-information system-information">
                <h3>5. Thông tin hệ thống</h3>
                <table className="information-table">
                  <thead><tr><th>Nội dung</th><th>Kết quả thu thập</th></tr></thead>
                  <tbody>{systemFields.map((field) => (
                    <tr key={field.code}><td>{field.label} <span className="field-code">({field.code})</span></td><td><input aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(event) => updateRecordDetail(field.code, event.target.value)} placeholder="Nhập kết quả thu thập" /></td></tr>
                  ))}</tbody>
                </table>
              </section>
            </div>
            <footer className="record-detail__footer"><span>Tự động lưu thay đổi</span><button className="add-button" onClick={() => setSelectedRecordId(null)}>Hoàn tất</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}
