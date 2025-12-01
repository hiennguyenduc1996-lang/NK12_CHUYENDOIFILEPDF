
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";

// PDF.js typing augmentation
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

type TabType = 'word' | 'latex' | 'latex-shuffle' | 'settings';

interface CustomFile {
    name: string;
    content: string;
}

const App = () => {
  // --- TABS STATE ---
  const [activeTab, setActiveTab] = useState<TabType>('word');
  const [lastActiveTab, setLastActiveTab] = useState<TabType>('word');

  // --- API KEY STATE ---
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  // --- CUSTOM PACKAGES STATE ---
  const [customFiles, setCustomFiles] = useState<CustomFile[]>([]);
  const [showPackages, setShowPackages] = useState<boolean>(false);

  // --- CONVERSION STATE ---
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState<string>(""); // Store text if user pastes text
  const [fileName, setFileName] = useState<string>("");
  
  // --- LATEX SHUFFLE STATE ---
  const [shuffleCodes, setShuffleCodes] = useState<string>("101, 102, 103, 104");
  const [disableTFShuffle, setDisableTFShuffle] = useState<boolean>(false);

  // --- RESULT STATE ---
  const [resultContent, setResultContent] = useState<string>("");
  const contentEditableRef = useRef<HTMLDivElement>(null); 
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [progress, setProgress] = useState<number>(0); // 0 to 100
  const [error, setError] = useState<string | null>(null);
  
  // --- CONTROL REFS ---
  const abortRef = useRef<boolean>(false); // To signal stop

  // --- PREVIEW MODE STATE ---
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);

  // --- INITIALIZATION ---
  useEffect(() => {
    const storedKey = localStorage.getItem("user_gemini_api_key");
    if (storedKey) setUserApiKey(storedKey);

    // Load custom files list
    const storedFiles = localStorage.getItem("custom_latex_files");
    if (storedFiles) {
        try {
            setCustomFiles(JSON.parse(storedFiles));
        } catch (e) {
            console.error("Error parsing stored files", e);
        }
    } else {
        // Migration for old keys (ex_test and anttor) to new system
        const oldExTest = localStorage.getItem("custom_sty_extest");
        const oldAnttor = localStorage.getItem("custom_sty_anttor");
        const migratedFiles: CustomFile[] = [];

        if (oldExTest) {
            migratedFiles.push({ name: "ex_test.sty", content: oldExTest });
            localStorage.removeItem("custom_sty_extest");
        }
        if (oldAnttor) {
            migratedFiles.push({ name: "anttor.sty", content: oldAnttor });
            localStorage.removeItem("custom_sty_anttor");
        }

        if (migratedFiles.length > 0) {
            setCustomFiles(migratedFiles);
            localStorage.setItem("custom_latex_files", JSON.stringify(migratedFiles));
        }
    }
  }, []);

  // Listen for paste events globally when on home tab to catch easy pastes
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (activeTab === 'word' || activeTab === 'latex') {
        handlePaste(e);
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [activeTab]);

  // Handle MathJax Rendering when entering Preview Mode
  useEffect(() => {
    if (isPreviewMode && resultContent && (window as any).MathJax) {
       setTimeout(() => {
          (window as any).MathJax.typesetPromise && (window as any).MathJax.typesetPromise();
       }, 100);
    }
  }, [isPreviewMode, resultContent]);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setUserApiKey(newVal);
    localStorage.setItem("user_gemini_api_key", newVal);
  };

  const handleCustomFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const newFiles: CustomFile[] = [];
          
          for (let i = 0; i < e.target.files.length; i++) {
              const file = e.target.files[i];
              try {
                  const content = await file.text();
                  // Check if file with same name exists, if so, replace it
                  const existingIndex = customFiles.findIndex(f => f.name === file.name);
                  if (existingIndex === -1) {
                      newFiles.push({ name: file.name, content: content });
                  } else {
                      // We will handle replacements by filtering old state first in the setter
                  }
              } catch (err) {
                  console.error(`Error reading file ${file.name}`, err);
              }
          }

          setCustomFiles(prev => {
              // Merge: remove duplicates from prev based on name if they exist in newFiles
              const filteredPrev = prev.filter(p => !newFiles.some(n => n.name === p.name));
              const updated = [...filteredPrev, ...newFiles];
              localStorage.setItem("custom_latex_files", JSON.stringify(updated));
              return updated;
          });
          
          // Reset input value to allow re-uploading same file if needed
          e.target.value = '';
      }
  };

  const handleDeleteCustomFile = (fileNameToDelete: string) => {
      setCustomFiles(prev => {
          const updated = prev.filter(f => f.name !== fileNameToDelete);
          localStorage.setItem("custom_latex_files", JSON.stringify(updated));
          return updated;
      });
  };

  const getApiKey = () => {
    return userApiKey.trim() || process.env.API_KEY || "";
  };

  // --- HELPER FUNCTIONS ---

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const createWordHtml = (content: string, title: string) => {
    return "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
      "xmlns:w='urn:schemas-microsoft-com:office:word' " +
      "xmlns='http://www.w3.org/TR/REC-html40'>" +
      "<head><meta charset='utf-8'><title>" + title + "</title>" +
      "<style>" + 
      "body { font-family: 'Be Vietnam Pro', 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; } " + 
      "p { margin-bottom: 6pt; margin-top: 0; } " +
      "table { border-collapse: collapse; width: 100%; margin-top: 10px; border: 2px solid #000; } " +
      "td { border: 1px solid #000; padding: 5px; color: #000; } " +
      "th { border: 1px solid #000; padding: 5px; background-color: #003366; color: #ffffff; font-weight: bold; } " +
      /* Force MathJax output to behave nicely in Word if possible, though Word uses images usually */
      "mjx-container { display: inline-block !important; margin: 0 !important; }" +
      "</style>" +
      "</head><body>" + content + "</body></html>";
  };

  const fileToGenericPart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        const base64Content = base64data.split(",")[1];
        resolve({ inlineData: { data: base64Content, mimeType: file.type } });
      };
      reader.onerror = () => reject(new Error("Lỗi khi đọc file."));
      reader.readAsDataURL(file);
    });
  };

  // --- SHUFFLING LOGIC (Fisher-Yates) ---
  const shuffleArray = (array: any[]) => {
      const newArr = [...array];
      for (let i = newArr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
      }
      return newArr;
  };

  // --- LATEX PARSING & SHUFFLING LOGIC ---
  const parseLatexQuestions = (content: string) => {
      // Clean comments to avoid regex issues, but be careful not to break structure
      // For simplicity, we assume standard structure \begin{ex} ... \end{ex}
      
      const questions: { 
          fullContent: string, 
          type: 'TN' | 'TF' | 'TL', // TN: Trắc nghiệm 4, TF: Đúng sai, TL: Tự luận
          hasChoice: boolean,
          id: string
      }[] = [];

      // Regex to find \begin{ex} ... \end{ex} blocks (non-greedy)
      const exRegex = /\\begin{ex}([\s\S]*?)\\end{ex}/g;
      let match;
      let count = 0;

      while ((match = exRegex.exec(content)) !== null) {
          const fullBlock = match[0];
          const innerContent = match[1];
          let type: 'TN' | 'TF' | 'TL' = 'TL';
          let hasChoice = false;

          if (innerContent.includes('\\choiceTF') || innerContent.includes('\\choiceTFt')) {
              type = 'TF';
          } else if (innerContent.includes('\\choice')) {
              type = 'TN';
              hasChoice = true;
          } else if (innerContent.includes('\\shortans')) {
              type = 'TL';
          }

          questions.push({
              fullContent: fullBlock,
              type,
              hasChoice,
              id: `q_${count++}`
          });
      }
      return questions;
  };

  const shuffleLatexContent = (originalContent: string, codes: string[], disableTFShuffle: boolean) => {
      const questions = parseLatexQuestions(originalContent);
      
      // Group questions
      const groupTN = questions.filter(q => q.type === 'TN');
      const groupTF = questions.filter(q => q.type === 'TF');
      const groupTL = questions.filter(q => q.type === 'TL');

      // Helper to process a single question (shuffle choices inside)
      const processQuestion = (q: typeof questions[0]) => {
          let content = q.fullContent;
          const cmdTN = '\\choice';
          const cmdTF = content.includes('\\choiceTFt') ? '\\choiceTFt' : '\\choiceTF';
          
          let targetCmd = '';
          if (q.type === 'TN') targetCmd = cmdTN;
          else if (q.type === 'TF') targetCmd = cmdTF;

          if (targetCmd) {
              const idx = content.indexOf(targetCmd);
              if (idx !== -1) {
                  const preCmd = content.substring(0, idx);
                  let cursor = idx + targetCmd.length;
                  
                  // 1. Check for Optional Argument [...]
                  let optionalArg = "";
                  // Skip whitespace carefully
                  while(cursor < content.length && /\s/.test(content[cursor])) cursor++;
                  
                  if (content[cursor] === '[') {
                      const startOpt = cursor;
                      while(cursor < content.length && content[cursor] !== ']') cursor++;
                      if (cursor < content.length) {
                          cursor++; // Include ']'
                          optionalArg = content.substring(startOpt, cursor);
                      }
                  }

                  // 2. Extract Options {A}{B}{C}{D}
                  const options: string[] = [];
                  let optCount = 0;
                  // We loop until we fail to find a starting brace or hit 4 (standard)
                  // Using brace counting to handle nested braces (TikZ, etc.)
                  
                  while (optCount < 4) {
                       // Skip whitespace
                       while(cursor < content.length && /\s/.test(content[cursor])) cursor++;
                       
                       if (content[cursor] === '{') {
                           let braceCount = 1;
                           const startContent = cursor;
                           cursor++;
                           while(cursor < content.length && braceCount > 0) {
                               if (content[cursor] === '{') braceCount++;
                               else if (content[cursor] === '}') braceCount--;
                               cursor++;
                           }
                           // Extracted option (including braces)
                           let opt = content.substring(startContent, cursor);
                           
                           // --- CLEAN A., B., C., D. prefix if present for cleaner shuffle ---
                           // Remove outer braces first to check
                           let inner = opt.substring(1, opt.length - 1);
                           let hasTrue = false;
                           if (inner.trim().startsWith('\\True')) {
                               hasTrue = true;
                               inner = inner.replace('\\True', '').trim();
                           }
                           // Regex to remove "A.", "a)", "1." at start of content
                           inner = inner.replace(/^[A-Da-d][.)]\s*/, '');
                           opt = `{${hasTrue ? '\\True ' : ''}${inner}}`;
                           // ---------------------------------------------------------------------------

                           options.push(opt);
                           optCount++;
                       } else {
                           // No more braces immediately found -> break
                           break;
                       }
                  }

                  const postCmd = content.substring(cursor);

                  // 3. Shuffle logic
                  if (options.length > 0) {
                      let shuffledOpts = options;
                      if (q.type === 'TN') {
                          shuffledOpts = shuffleArray(options);
                      } else if (q.type === 'TF' && !disableTFShuffle) {
                          shuffledOpts = shuffleArray(options);
                      }
                      
                      // 4. Reconstruct
                      content = `${preCmd}${targetCmd}${optionalArg}\n${shuffledOpts.join('\n')}${postCmd}`;
                  }
              }
          }
          return content;
      };

      let finalLatex = `\\documentclass[12pt,a4paper]{article}
\\usepackage[light,condensed,math]{anttor}
\\everymath{\\rm}
%Các gói
%\\usepackage{fourier}
%\\usepackage{yhmath}
\\usepackage{amsmath,amssymb,grffile,makecell,fancyhdr,enumerate,arcs,physics,tasks,mathrsfs,graphics}
\\usepackage{tikz,tikz-3dplot,tkz-euclide,tkz-tab,tkz-linknodes,tabvar,pgfplots,esvect}
\\usepackage[top=1.2cm, bottom=1.2cm, left=1.5cm, right=1.5cm]{geometry}
\\usepackage[hidelinks,unicode]{hyperref}
\\usepackage[utf8]{vietnam}
\\usepackage[dethi]{ex_test}
%
%Các thư viện
\\usetikzlibrary{shapes.geometric,shadings,calc,snakes,patterns,arrows,intersections,angles,backgrounds,quotes}
\\usetikzlibrary{decorations.markings}
\\usetikzlibrary{decorations.pathmorphing,patterns}
\\usetikzlibrary{circuits}
\\usetikzlibrary{circuits.ee.IEC}
\\usepackage[siunitx]{circuitikz}
\\tikzset{middlearrow/.style={decoration={markings,mark= at position 0.5 with {\\arrow{#1}},},postaction={decorate}}}
\\renewcommand{\\baselinestretch}{0.85}% Lệnh dãn dòng
%Các thư viện
\\usetikzlibrary{shapes.geometric,shadings,calc,snakes,patterns,arrows,intersections,angles,backgrounds,quotes}
%\\usetkzobj{all}
\\usepgfplotslibrary{fillbetween}
\\pgfplotsset{compat=newest}
%
%Một số lệnh tắt
\\def\\vec{\\overrightarrow}
\\newcommand{\\hoac}[1]{\\left[\\begin{aligned}#1\\end{aligned}\\right.}
\\newcommand{\\heva}[1]{\\left\\{\\begin{aligned}#1\\end{aligned}\\right.}
\\newcommand{\\hetde}{\\centerline{\\rule[0.5ex]{2cm}{1pt} HẾT \\rule[0.5ex]{2cm}{1pt}}}
%
%Tiêu đề
\\newcommand{\\tentruong}{}
\\newcommand{\\tengv}{}
\\newcommand{\\tenkythi}{ĐỀ ÔN TẬP THI HỌC KÌ 1}
\\newcommand{\\tenmonthi}{MÔN: VẬT LÍ}
\\newcommand{\\thoigian}{50}
\\newcommand{\\tieude}[3]{
\\noindent
%Trái
\\begin{minipage}[t]{8cm}
\\centerline{\\textbf{\\fontsize{13}{0}\\selectfont \\tentruong}}
\\centerline{\\textbf{\\fontsize{13}{0}\\selectfont \\tengv}}
\\centerline{(\\textit{Đề thi có #1\\ trang})}
\\end{minipage}\\hspace{1.5cm}
%Phải
\\begin{minipage}[t]{9cm}
\\centerline{\\textbf{\\fontsize{13}{0}\\selectfont \\tenkythi}}
\\centerline{\\textbf{\\fontsize{13}{0}\\selectfont \\tenmonthi}}
\\centerline{\\textit{\\fontsize{12}{0}\\selectfont Thời gian làm bài \\thoigian\\;phút}}
\\end{minipage}
\\begin{minipage}[t]{10cm}
\\textbf{Họ và tên thí sinh: }{\\tiny\\dotfill}
\\end{minipage}
\\begin{minipage}[b]{8cm}
\\hspace*{4cm}\\fbox{\\bf Mã đề thi #3}
\\end{minipage}\\vspace{3pt}
}
%Lệnh dùng cho trắc nghiệm chấm tay
\\newcommand*\\circletext[1]{\\tikz[baseline=(char.base)]{
            \\node[shape=circle,draw,inner sep=0.5pt] (char) {\\fontsize{10}{0}\\selectfont#1};}}
\\newcommand*\\fillcircletext[1]{\\tikz[baseline=(char.base)]{
            \\node[shape=circle,draw,fill=black,inner sep=0.6pt] (char) {\\fontsize{10}{0}\\selectfont#1};}}
%chân trang
\\newcommand{\\chantrang}[2]{\\rfoot{Trang \\thepage/#1 $-$ Mã đề #2}}
%Tùy chỉnh ex_test
\\renewtheorem{ex}{\\color{black}\\selectfont\\bfseries Câu}
\\renewcommand{\\FalseEX}{\\stepcounter{dapan}{\\noindent{\\textbf{\\Alph{dapan}.}}}}
%\\fontdimen2\\font=3.5pt% Lệnh tăng giảm khoảng các các chữ
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\newcommand{\\tieudea}[2]{\\noindent\\textbf{PHẦN #1.} Thí sinh trả lời từ câu 1 đến câu #2. Mỗi câu hỏi thí sinh chỉ chọn một phương án.}
\\newcommand{\\tieudeb}[2]{\\noindent\\textbf{PHẦN #1.} Thí sinh trả lời từ câu 1 đến câu #2. Mỗi ý \\textbf{a), b), c), d)} ở mỗi câu hỏi, thí sinh chọn \\textbf{đúng} hoặc \\textbf{sai}.}
\\newcommand{\\tieudec}[2]{\\noindent\\textbf{PHẦN #1.} Thí sinh trả lời từ câu 1 đến câu #2.}
\\newcommand{\\tieuded}[1]{\\noindent\\textbf{PHẦN #1. PHẦN TỰ LUẬN}}
\\newenvironment{dapanMyLT}{}{}
%\\usepackage{verbatim}\\renewenvironment{dapanMyLT}{\\comment}{\\endcomment}%Ẩn đáp án
\\begin{document}
`;

      codes.forEach((code) => {
          const shuffledTN = shuffleArray(groupTN).map(processQuestion);
          const shuffledTF = shuffleArray(groupTF).map(processQuestion);
          const shuffledTL = shuffleArray(groupTL).map(processQuestion);
          
          finalLatex += `
\\tieude{\\pageref{${code}}}{18}{${code}}
\\chantrang{\\pageref{${code}}}{${code}}
\\setcounter{page}{1}

% --- PHẦN 1: TRẮC NGHIỆM ---
\\tieudea{I}{${shuffledTN.length}}
\\setcounter{ex}{0}
\\Opensolutionfile{ansbook}[ansbookMyLTTN${code}]
\\Opensolutionfile{ans}[ansMyLTTN${code}]
${shuffledTN.join('\n')}
\\Closesolutionfile{ans}
\\Closesolutionfile{ansbook}

% --- PHẦN 2: ĐÚNG SAI ---
\\tieudeb{II}{${shuffledTF.length}}
\\setcounter{ex}{0}
\\Opensolutionfile{ansbook}[ansbookMyLTTF${code}]
\\Opensolutionfile{ans}[ansMyLTTF${code}]
${shuffledTF.join('\n')}
\\Closesolutionfile{ans}
\\Closesolutionfile{ansbook}

% --- PHẦN 3: TỰ LUẬN/NGẮN ---
\\tieuded{III}
\\setcounter{ex}{0}
\\Opensolutionfile{ansbook}[ansbookMyLTTL${code}]
\\Opensolutionfile{ans}[ansMyLTTL${code}]
${shuffledTL.join('\n')}
\\Closesolutionfile{ans}
\\Closesolutionfile{ansbook}

\\hetde
\\label{${code}}
\\newpage
`;
      });

      // --- CREATE ANSWER KEYS FOR ALL CODES ---
      finalLatex += `
\\setcounter{page}{1}
\\rfoot{Trang \\thepage $-$ Đáp án các mã đề}
\\foreach\\i in {${codes.join(',')}}{
\\begin{center}
\\bf ĐÁP ÁN PHẦN TRẮC NGHIỆM 4 PHƯƠNG ÁN - MÃ ĐỀ \\i\\vspace{12pt}
\\inputansbox[1]{9}{ansMyLTTN\\i}
\\bf ĐÁP ÁN PHẦN TRẮC NGHIỆM ĐÚNG SAI
\\inputansbox[2]{2}{ansMyLTTF\\i}
\\bf ĐÁP ÁN PHẦN TỰ LUẬN
\\inputansbox[3]{6}{ansMyLTTL\\i}
\\end{center}
}
\\end{document}
`;
      
      return finalLatex;
  };

  const executeLatexShuffle = async () => {
      if (!file && !pastedText) return setError("Vui lòng tải file .tex hoặc dán nội dung.");
      
      setIsLoading(true);
      setError(null);
      setLoadingStatus("Đang đọc file...");
      
      try {
          let content = "";
          if (file) {
              content = await file.text();
          } else {
              content = pastedText;
          }

          if (!content) throw new Error("File rỗng.");
          
          setLoadingStatus("Đang phân tích và trộn đề...");
          await wait(500); // UI feel

          const codes = shuffleCodes.split(',').map(c => c.trim()).filter(c => c);
          if (codes.length === 0) throw new Error("Vui lòng nhập ít nhất 1 mã đề.");

          const finalLatex = shuffleLatexContent(content, codes, disableTFShuffle);
          
          setResultContent(finalLatex);
          setLoadingStatus("");
          setProgress(100);
      } catch (err: any) {
          setError(err.message);
      } finally {
          setIsLoading(false);
      }
  };

  // --- PDF PROCESSING LOGIC ---

  const renderPdfPageToImage = async (pdfDoc: any, pageNum: number, scale = 2.0): Promise<string> => {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;
    // Return base64 string without the prefix for Gemini
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    return dataUrl.split(',')[1];
  };

  const processWithAI = async (parts: any[], mode: 'convert' | 'solve', currentTab: TabType, isFirstBatch: boolean = true) => {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const modelId = "gemini-2.5-flash";

      let systemInstruction = "";

      // === PROMPTS FOR WORD (HTML) ===
      if (currentTab === 'word') {
          if (mode === 'convert') {
             systemInstruction = `
Bạn là chuyên gia chuyển đổi tài liệu Toán - Lý - Hóa.
Nhiệm vụ: Chép lại nội dung hình ảnh/văn bản đầu vào thành mã HTML sạch, chuẩn để dán vào Word.

TUÂN THỦ 100% QUY TẮC:
1. **Chính tả & Unicode**: Sửa lỗi chính tả tiếng Việt và lỗi font unicode.
2. **Toán học & Khoa học**:
   - Công thức toán BẮT BUỘC đặt trong dấu $...$ (LaTeX inline).
   - Công thức trong dòng dùng $...$ (inline), KHÔNG dùng $$...$$ (block) và KHÔNG xuống dòng ngắt quãng.
   - Thay thế toàn bộ lệnh \\frac bằng lệnh \\dfrac để phân số to rõ hơn.
   - Ký tự Hy Lạp: ρ → \\rho, θ → \\theta, α → \\alpha...
   - Đơn vị: $50\\;cm$, $300^\\circ C$, \\%.
3. **Cấu trúc**:
   - XÓA bảng đánh dấu Đúng/Sai, thay bằng danh sách a), b)...
   - Bỏ dấu "*" thừa.
   - Dùng thẻ <p> cho đoạn văn, <br> ngắt dòng.
4. **Nguyên tắc**: Chỉ trả về HTML body content. Không Markdown.
`;
          } else {
             systemInstruction = `
Bạn là giáo viên giỏi.
Nhiệm vụ: Giải chi tiết và hướng dẫn làm bài cho nội dung đầu vào.

YÊU CẦU:
1. Trích dẫn câu hỏi (ngắn gọn) rồi giải chi tiết.
2. Giải thích logic, công thức.
3. Dùng HTML (<h3>, <p>, <b>, <ul>).
4. Toán/Lý/Hóa dùng LaTeX trong dấu $. Dùng \\dfrac thay vì \\frac. Viết liền mạch, KHÔNG xuống dòng ngắt quãng.
5. **QUAN TRỌNG**: Sau khi giải chi tiết xong, hãy tự rút ra đáp án đúng nhất cho từng câu và điền vào bảng tổng hợp cuối cùng. Tuyệt đối không được để bảng trống.
6. **ĐỊNH DẠNG BẢNG ĐÁP ÁN**: Tạo bảng HTML 10 cột, nội dung dạng **1.A**, **2.B**. Tiêu đề bảng là "BẢNG ĐÁP ÁN TỔNG HỢP".
`;
          }
      } 
      // === PROMPTS FOR LATEX ===
      else if (currentTab === 'latex') {
          // --- DETAILED LATEX TEMPLATE ---
          const fullLatexTemplate = `
\\documentclass[12pt,a4paper]{article}
\\usepackage[light,condensed,math]{anttor}
\\everymath{\\rm}
%Các gói
\\usepackage{amsmath,amssymb,grffile,makecell,fancyhdr,enumerate,arcs,physics,tasks,mathrsfs,graphics}
\\usepackage{tikz,tikz-3dplot,tkz-euclide,tkz-tab,tkz-linknodes,tabvar,pgfplots,esvect}
\\usepackage[top=1.5cm, bottom=1.5cm, left=2cm, right=1.5cm]{geometry}
\\usepackage[hidelinks,unicode]{hyperref}
\\usepackage[utf8]{vietnam}
\\usepackage[most,xparse,many]{tcolorbox}
\\usepackage[dethi]{ex_test}
%
%Các thư viện
\\usetikzlibrary{shapes.geometric,shadings,calc,snakes,patterns,arrows,intersections,angles,backgrounds,quotes}
\\usepgfplotslibrary{fillbetween}
\\pgfplotsset{compat=newest}
\\tikzset{middlearrow/.style={decoration={markings,mark= at position 0.5 with {\\arrow{#1}},},postaction={decorate}}}
\\tikzset{middlearrow/.style={decoration={markings,mark= at position 0.5 with {\\arrow{#1}},},postaction={decorate}}}
\\tikzset{on each segment/.style={decorate,decoration={show path construction,moveto code={},lineto code={
\\path [#1] (\\tikzinputsegmentfirst) -- (\\tikzinputsegmentlast);},curveto code={
\\path [#1] (\\tikzinputsegmentfirst).. controls (\\tikzinputsegmentsupporta) and (\\tikzinputsegmentsupportb)..(\\tikzinputsegmentlast);},closepath code={
\\path [#1] (\\tikzinputsegmentfirst) -- (\\tikzinputsegmentlast);},},},mid arrow/.style={postaction={decorate,decoration={markings,mark=at position .5 with {\\arrow[#1]{stealth}}}}},}
%
%Một số lệnh tắt
\\def\\vec{\\overrightarrow}
\\newcommand{\\hoac}[1]{\\left[\\begin{aligned}#1\\end{aligned}\\right.}
\\newcommand{\\heva}[1]{\\left\\{\\begin{aligned}#1\\end{aligned}\\right.}
\\newcommand{\\hetde}{\\centerline{\\rule[0.5ex]{2cm}{1pt} HẾT \\rule[0.5ex]{2cm}{1pt}}}
%
%Tiêu đề
\\newcommand{\\tentruong}{}
\\newcommand{\\tengv}{}
\\newcommand{\\tenkythi}{ĐỀ KIỂM TRA THƯỜNG XUYÊN}
\\newcommand{\\tenmonthi}{MÔN VẬT LÍ, NHIỆT VÀ KHÍ}
\\newcommand{\\thoigian}{50}
\\newcommand{\\made}{NK2}
\\newcommand{\\tieude}[3]{
\\noindent
%Trái
\\begin{minipage}[b]{7cm}
\\centerline{\\textbf{\\fontsize{13}{0}\\selectfont \\tentruong}}
\\centerline{\\textbf{\\fontsize{13}{0}\\selectfont \\tengv}}
\\centerline{(\\textit{Đề có 0#1\\ trang})}
\\end{minipage}\\hspace{1.5cm}
%Phải
\\begin{minipage}[b]{9cm}
\\centerline{\\textbf{\\fontsize{13}{0}\\selectfont \\tenkythi}}
\\centerline{\\textbf{\\fontsize{13}{0}\\selectfont \\tenmonthi}}
\\centerline{\\textit{\\fontsize{12}{0}\\selectfont Thời gian làm bài \\thoigian\\ phút}}
\\end{minipage}
\\begin{minipage}[b]{10cm}
\\textbf{Họ và tên thí sinh: }{\\tiny\\dotfill}
\\end{minipage}
\\begin{minipage}[b]{8cm}
\\hspace*{4cm}\\fbox{\\bf Mã đề thi #3}
\\end{minipage}\\vspace{3pt}
}
%Lệnh dùng cho trắc nghiệm chấm tay
\\newcommand*\\circletext[1]{\\tikz[baseline=(char.base)]{
            \\node[shape=circle,draw,inner sep=0.5pt] (char) {\\fontsize{10}{0}\\selectfont#1};}}
\\newcommand*\\fillcircletext[1]{\\tikz[baseline=(char.base)]{
            \\node[shape=circle,draw,fill=black,inner sep=0.6pt] (char) {\\fontsize{10}{0}\\selectfont#1};}}
\\renewtheorem{ex}{\\color{black}\\selectfont\\bfseries Câu}
\\renewcommand{\\FalseEX}{\\stepcounter{dapan}{\\noindent{\\textbf{\\Alph{dapan}.}}}}
%chân trang
\\newcommand{\\chantrang}[2]{\\rfoot{Trang \\thepage/#1 $-$ Mã đề #2}}
%
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\begin{document}
\\tieude{\\pageref{101}}{18}{\\made}
\\chantrang{\\pageref{101}}{\\made}
\\setcounter{page}{1}
\\noindent\\textbf{PHẦN I. TRẮC NGHIỆM 4 PHƯƠNG ÁN.} Thí sinh trả lời từ câu 1 đến câu 18. Mỗi câu hỏi thí sinh chỉ chọn một phương án.
\\vspace{0.5 cm}
\\setcounter{ex}{0}
\\Opensolutionfile{ans}[tnde7]
%% NỘI DUNG PHẦN 1 TẠI ĐÂY %%
\\Closesolutionfile{ans}
\\vspace{0.5 cm}
\\noindent\\textbf{PHẦN II. TRẮC NGHIỆM ĐÚNG SAI.} Thí sinh trả lời từ câu 1 đến câu 4. Mỗi ý a), b), c), d) ở mỗi câu hỏi, thí sinh chọn đúng hoặc sai.
\\vspace{0.5 cm}
\\setcounter{ex}{0}
\\Opensolutionfile{ans}[dsde7]
%% NỘI DUNG PHẦN 2 TẠI ĐÂY %%
\\Closesolutionfile{ans}
\\vspace{0.5 cm}
\\noindent\\textbf{PHẦN III. TRẮC NGHIỆM TRẢ LỜI NGẮN.} Thí sinh trả lời từ câu 1 đến câu 6.
\\vspace{0.5 cm}
\\setcounter{ex}{0}
\\Opensolutionfile{ans}[tlnde7]
%% NỘI DUNG PHẦN 3 TẠI ĐÂY %%
\\Closesolutionfile{ans}
\\hetde
\\label{101}
\\newpage
\\centerline{\\textbf{\\fontsize{20}{0}\\selectfont ĐÁP ÁN ĐỀ KIỂM TRA VẬT LÍ MÃ ĐỀ \\made}}
\\setcounter{page}{1}
\\begin{center}
\\bf ĐÁP ÁN PHẦN TRẮC NGHIỆM 4 PHƯƠNG ÁN\\vspace{12pt}
\\inputansbox[1]{10}{tnde7}
\\bf ĐÁP ÁN PHẦN TRẮC NGHIỆM ĐÚNG SAI 
\\inputansbox[2]{2}{dsde7}
\\bf ĐÁP ÁN PHẦN TRẢ LỜI NGẮN
\\inputansbox[3]{6}{tlnde7}
\\end{center}
\\end{document}
`;

          if (mode === 'convert') {
              if (isFirstBatch) {
                  systemInstruction = `
Bạn là chuyên gia chuyển đổi LaTeX sử dụng gói lệnh 'ex_test' (tương tự dethi.sty).
Nhiệm vụ: Chuyển đổi nội dung đầu vào thành mã LaTeX hoàn chỉnh theo MẪU BẮT BUỘC dưới đây.

MẪU CẤU TRÚC (Tuyệt đối tuân thủ):
${fullLatexTemplate}

HƯỚNG DẪN ĐIỀN NỘI DUNG VÀO 3 PHẦN:

1. **PHẦN I (Trắc nghiệm 4 đáp án)**: Điền vào chỗ %% NỘI DUNG PHẦN 1 TẠI ĐÂY %%. Dùng cấu trúc:
   \\begin{ex}
   Nội dung câu hỏi...
   \\choice
   {\\True A}
   {B}
   {C}
   {D}
   \\loigiai{
     \\begin{itemize}
       \\item Ý 1...
       \\item Ý 2...
     \\end{itemize}
   }
   \\end{ex}
   **QUY TẮC**: 
   - Sau \\begin{ex} phải xuống dòng rồi mới viết nội dung câu hỏi.
   - **XÓA BỎ HOÀN TOÀN** các ký tự A., B., C., D. ở đầu các phương án trong \\choice.
   - Các phương án trong \\choice phải xuống dòng.
   - Nếu có lời giải, phải đặt trong môi trường itemize như mẫu trên.

2. **PHẦN II (Đúng/Sai)**: Điền vào chỗ %% NỘI DUNG PHẦN 2 TẠI ĐÂY %%. Dùng cấu trúc:
   \\begin{ex}
   Nội dung câu hỏi...
   \\choiceTFt
   {\\True Ý đúng 1}
   {Ý sai 1}
   {\\True Ý đúng 2}
   {Ý sai 2}
   \\loigiai{
     \\begin{itemize}
       \\item Ý 1...
       \\item Ý 2...
     \\end{itemize}
   }
   \\end{ex}
   **QUY TẮC QUAN TRỌNG**:
   - Sau \\begin{ex} phải xuống dòng.
   - **BỎ HOÀN TOÀN** các ký tự a), b), c), d).
   - Nếu ý là ĐÚNG -> Thêm tiền tố \\True vào đầu nội dung ý đó: {\\True Nội dung}.
   - Nếu ý là SAI -> Chỉ viết nội dung: {Nội dung}.
   - Viết mỗi ý trên một dòng riêng biệt.

3. **PHẦN III (Trả lời ngắn)**: Điền vào chỗ %% NỘI DUNG PHẦN 3 TẠI ĐÂY %%. Dùng cấu trúc:
   \\begin{ex}
   Nội dung câu hỏi...
   \\shortans[oly]{Đáp án}
   \\loigiai{
     \\begin{itemize}
       \\item ...
     \\end{itemize}
   }
   \\end{ex}

4. **KHÔNG** thay đổi phần Preamble (khai báo gói, lệnh tắt, tiêu đề) của mẫu. Giữ nguyên y hệt.
5. Tự động nhận diện đáp án đúng (gạch chân/tô màu) để thêm lệnh \\True hoặc điền đáp án.
6. **QUY TẮC CHUNG**:
   - Thay thế toàn bộ lệnh \\frac thành \\dfrac.
   - Công thức toán inline dùng $...$.
   - Bảng (tabular) bắt buộc đặt trong \\begin{center}...\\end{center}.
   - Loại bỏ dấu chấm (.) ở cuối cùng của nội dung các phương án.
7. Chỉ trả về mã LaTeX hoàn chỉnh.
`;
              } else {
                  // CONTINUATION PROMPT
                  systemInstruction = `
Bạn đang tiếp tục chuyển đổi tài liệu LaTeX từ đợt trước.
Nhiệm vụ: Chuyển đổi nội dung tiếp theo thành mã LaTeX (dạng ex_test).

QUAN TRỌNG:
1. **KHÔNG** tạo lại phần khai báo (Preamble), \\documentclass, hay \\begin{document}.
2. **CHỈ** xuất ra các câu hỏi tiếp theo (\\begin{ex}...\\end{ex}).
3. Tuân thủ định dạng phần Đúng/Sai (\\choiceTFt):
   - **BỎ** a), b), c), d).
   - Dùng tiền tố {\\True Nội dung} cho câu đúng.
   - Xuống dòng sau \\begin{ex} và các phương án.
4. Tuân thủ định dạng phần Trắc nghiệm (\\choice):
   - **BỎ** A., B., C., D. ở đầu phương án.
5. Tuân thủ quy tắc: \\dfrac, bảng center, bỏ dấu chấm cuối phương án.
6. Nếu có lời giải, phải đặt trong \\begin{itemize} bên trong \\loigiai{}.
7. KHÔNG giải bài, chỉ chuyển đổi nội dung.
`;
              }
          } else {
              // SOLVE MODE
               systemInstruction = `
Bạn là giáo viên giỏi. Giải chi tiết đề thi và xuất ra mã LaTeX theo MẪU BẮT BUỘC.

MẪU CẤU TRÚC:
${fullLatexTemplate}

YÊU CẦU:
1. Điền lời giải chi tiết vào bên trong thẻ \\loigiai{...} cho từng câu.
2. **BẮT BUỘC**: Nội dung lời giải phải đặt trong môi trường itemize:
   \\loigiai{
     \\begin{itemize}
       \\item Bước 1...
       \\item Bước 2...
     \\end{itemize}
   }
3. Tuân thủ định dạng \\choiceTFt: **BỎ** a,b,c,d; dùng \\True ở đầu câu đúng; xuống dòng rõ ràng.
4. Tuân thủ định dạng \\choice: **BỎ** A,B,C,D ở đầu phương án.
5. Thay thế tất cả lệnh \\frac thành \\dfrac.
6. Loại bỏ dấu chấm (.) ở cuối cùng của nội dung các phương án.
7. **BẢNG BIỂU**: Bắt buộc đặt trong \\begin{center}...\\end{center}.
8. Chỉ trả về mã LaTeX hoàn chỉnh.
`;
          }
      }

      // Add prompt to parts
      const requestParts = [...parts, { text: systemInstruction }];

      const response = await ai.models.generateContent({
        model: modelId,
        contents: { parts: requestParts },
        config: { temperature: mode === 'convert' ? 0.1 : 0.4 }
      });

      let text = response.text || "";
      // Strip markdown code blocks if any remain
      return text.replace(/```html|```latex|```tex|```/g, "").trim();
  };

  const processPdfInBatches = async (file: File, mode: 'convert' | 'solve') => {
    try {
      if (!window.pdfjsLib) throw new Error("Thư viện PDF chưa tải xong. Vui lòng đợi 3 giây rồi thử lại.");
      
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await window.pdfjsLib.getDocument(arrayBuffer).promise;
      const totalPages = pdfDoc.numPages;
      const BATCH_SIZE = 6; // Process 6 pages at a time
      const MAX_RETRIES = 5;
      
      let finalResult = "";

      for (let i = 1; i <= totalPages; i += BATCH_SIZE) {
        // CHECK STOP CONDITION
        if (abortRef.current) {
            setLoadingStatus("Đã dừng bởi người dùng.");
            break;
        }

        const startPage = i;
        const endPage = Math.min(i + BATCH_SIZE - 1, totalPages);
        const isFirstBatch = i === 1;
        
        setProgress(Math.round(((i - 1) / totalPages) * 100));

        // RETRY LOOP
        let success = false;
        let retryCount = 0;

        while (!success && !abortRef.current && retryCount < MAX_RETRIES) {
            try {
                setLoadingStatus(`Đang xử lý trang ${startPage} - ${endPage} / ${totalPages}... ${retryCount > 0 ? `(Thử lại lần ${retryCount})` : ''}`);
                
                // Render pages in this batch to images
                const imageParts = [];
                for (let p = startPage; p <= endPage; p++) {
                    const base64Image = await renderPdfPageToImage(pdfDoc, p);
                    imageParts.push({ inlineData: { data: base64Image, mimeType: 'image/jpeg' } });
                }

                // Send this batch to AI (Pass activeTab to select prompt)
                let batchResult = await processWithAI(imageParts, mode, activeTab as TabType, isFirstBatch);
                
                // Check Abort BEFORE updating content
                if (abortRef.current) {
                    setLoadingStatus("Đã dừng. Bỏ qua kết quả cuối.");
                    break;
                }
                
                // --- POST-PROCESSING FOR BATCHING ---
                if (activeTab === 'latex') {
                    // For batches > 1, we just append the EX content.
                    // However, we need to handle the closing tags from the previous batch if they exist, or structure the stream.
                    // SIMPLIFIED APPROACH:
                    // 1. If it's the first batch, we keep everything BUT the \end{document}
                    // 2. If it's a middle batch, we just append the content (which AI should generate as just questions)
                    // 3. At the very end of loop, we append \end{document}
                    
                    if (isFirstBatch) {
                        // Remove \end{document} from the end if it exists
                        batchResult = batchResult.replace(/\\end{document}/g, "").trim();
                    } else {
                        // Ensure no preamble is accidentally included (AI might hallucinate) by simple string matching or just trust the prompt
                        // We strictly append.
                    }
                    
                    finalResult += batchResult + "\n\n% --- Next Batch ---\n\n";
                    setResultContent(finalResult); 

                } else {
                     // Word mode: simple append
                     finalResult += batchResult + "<br/><br/>";
                     setResultContent(finalResult);
                }
                
                success = true; // Mark as success to exit retry loop
            } catch (err) {
                console.warn(`Batch ${startPage}-${endPage} failed:`, err);
                retryCount++;
                if (retryCount >= MAX_RETRIES) {
                    const errorMsg = activeTab === 'word' 
                        ? `<br/><p style="color:red; font-weight:bold;">[LỖI: Không thể xử lý trang ${startPage}-${endPage} sau nhiều lần thử. Đang bỏ qua...]</p><br/>`
                        : `\n% [LỖI: Không thể xử lý trang ${startPage}-${endPage} sau nhiều lần thử]\n`;
                    finalResult += errorMsg;
                    setResultContent(finalResult);
                    // We don't throw here, we just skip this chunk and continue to next
                    success = true; 
                } else {
                    if (abortRef.current) break;
                    setLoadingStatus(`Gặp lỗi kết nối. Đang đợi 5 giây để thử lại (Lần ${retryCount}/${MAX_RETRIES})...`);
                    await wait(5000); // Wait 5 seconds before retrying
                }
            }
        }
      }

      if (!abortRef.current) {
          // Finalize document for LaTeX
          if (activeTab === 'latex') {
              setResultContent(prev => prev + "\n\\end{document}");
          }
          setProgress(100);
      }

    } catch (e: any) {
      throw new Error(`Lỗi xử lý PDF: ${e.message}`);
    }
  };

  // --- HANDLERS ---

  const handleStop = () => {
    // Immediate feedback, no confirmation dialog
    abortRef.current = true;
    setLoadingStatus("Đang dừng... (Vui lòng đợi xử lý nốt phần hiện tại)");
  };

  const handleTabChange = (newTab: TabType) => {
      // Clear content when switching contexts to avoid format mismatch
      if (newTab !== activeTab && newTab !== 'settings') {
          setResultContent("");
          setFile(null);
          setFileName("");
          setPastedText("");
          setProgress(0);
          setError(null);
      }
      setActiveTab(newTab);
  };

  const handleSettingsClick = () => {
      setLastActiveTab(activeTab);
      setActiveTab('settings');
  };

  const handleBackClick = () => {
      setActiveTab(lastActiveTab);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setFileName(selectedFile.name);
      setPastedText(""); 
      setError(null);
      setResultContent("");
      setIsPreviewMode(false);
      setProgress(0);
    }
  };

  const handlePaste = (e: React.ClipboardEvent | ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          setFile(blob);
          setFileName("Pasted_Image_" + new Date().getTime() + ".png");
          setPastedText("");
          setError(null);
          setResultContent("");
          setIsPreviewMode(false);
          setProgress(0);
          e.preventDefault();
          return;
        }
      }
    }
    
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
        const text = e.clipboardData?.getData("text");
        if (text) {
             setPastedText(text);
             setFile(null);
             setFileName("");
             setError(null);
             setResultContent("");
             setIsPreviewMode(false);
             setProgress(0);
        }
    }
  };

  const executeAction = async (mode: 'convert' | 'solve') => {
    if (!file && !pastedText) return setError("Vui lòng tải file hoặc dán nội dung (Ctrl+V).");
    
    setIsLoading(true);
    abortRef.current = false; // RESET STOP FLAG
    setError(null);
    setResultContent(""); 
    setLoadingStatus("Đang khởi tạo...");
    setProgress(0);
    setIsPreviewMode(false);

    try {
      // CASE 1: PDF FILE (Use Batching with Auto-Retry)
      if (file && file.type === 'application/pdf') {
         await processPdfInBatches(file, mode);
      } 
      // CASE 2: IMAGE OR TEXT (Single Request)
      else {
          setProgress(50);
          setLoadingStatus("Đang gửi dữ liệu lên AI...");
          const parts: any[] = [];
          
          if (file) {
              const filePart = await fileToGenericPart(file);
              parts.push(filePart);
          } else if (pastedText) {
              parts.push({ text: `Nội dung đầu vào:\n${pastedText}` });
          }

          // Pass activeTab to select prompt
          const result = await processWithAI(parts, mode, activeTab as TabType);
          if (!abortRef.current) {
              setResultContent(result);
              setProgress(100);
          }
      }

    } catch (err: any) {
      if (!abortRef.current) {
         setError("Lỗi: " + err.message);
      }
      setProgress(0);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  const handleDownload = () => {
    let contentToSave = resultContent;
    if (contentEditableRef.current) {
        // If Word, get InnerHTML. If LaTeX, get InnerText (raw code)
        contentToSave = activeTab === 'word' 
            ? contentEditableRef.current.innerHTML 
            : contentEditableRef.current.innerText;
    }
    if (!contentToSave) return;

    if (activeTab === 'word') {
        const sourceHTML = createWordHtml(contentToSave, "Converted Document");
        const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
        const link = document.createElement("a");
        link.href = source;
        link.download = `Converted_${fileName.split('.')[0] || 'Document'}.doc`;
        link.click();
    } else {
        // LaTeX Download (.tex file)
        const element = document.createElement("a");
        const file = new Blob([contentToSave], {type: 'text/plain'});
        element.href = URL.createObjectURL(file);
        element.download = `Converted_${fileName.split('.')[0] || 'Document'}.tex`;
        document.body.appendChild(element); 
        element.click();
        document.body.removeChild(element);
    }
  };

  const handleCopy = () => {
    let contentToCopy = "";
    if (contentEditableRef.current) {
         // Copy raw text for Latex, HTML for Word
         contentToCopy = activeTab === 'word' 
            ? contentEditableRef.current.innerHTML 
            : contentEditableRef.current.innerText;
    } else {
        contentToCopy = resultContent;
    }

    if (!contentToCopy) {
      alert("Không có nội dung để sao chép.");
      return;
    }

    try {
        if (activeTab === 'word') {
            const blob = new Blob([contentToCopy], { type: "text/html" });
            const textBlob = new Blob([contentEditableRef.current?.innerText || resultContent], { type: "text/plain" });
            const data = [new ClipboardItem({
                ["text/html"]: blob,
                ["text/plain"]: textBlob
            })];
            navigator.clipboard.write(data).then(() => alert("Đã sao chép nội dung Word!"));
        } else {
            // Simple text copy for LaTeX
            navigator.clipboard.writeText(contentToCopy).then(() => alert("Đã sao chép mã LaTeX!"));
        }
    } catch (err) {
        console.error("Lỗi khi sao chép:", err);
        alert("Lỗi khi sao chép. Vui lòng thử lại.");
    }
  };

  const handleOpenOverleaf = () => {
      let latexCode = "";
      if (contentEditableRef.current) {
          latexCode = contentEditableRef.current.innerText;
      } else {
          latexCode = resultContent;
      }

      if (!latexCode) {
          alert("Không có nội dung để chuyển sang Overleaf.");
          return;
      }

      // PREPARE PACKAGE INJECTION
      let packagesHeader = "";
      
      // Inject all custom files
      if (customFiles.length > 0) {
          customFiles.forEach(f => {
              packagesHeader += `\\begin{filecontents*}{${f.name}}\n${f.content}\n\\end{filecontents*}\n\n`;
          });
      }

      const finalCode = packagesHeader + latexCode;

      // Create a form to POST data to Overleaf
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'https://www.overleaf.com/docs';
      form.target = '_blank';

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'snip';
      input.value = finalCode;

      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
  };

  const handleContentChange = (e: React.FormEvent<HTMLDivElement>) => {
     // For LaTeX we might want to preserve line breaks more carefully, but standard innerHTML -> state is fine for now
     setResultContent(e.currentTarget.innerHTML);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden" onPaste={handlePaste}>
      
      {/* LEFT PANEL: Sidebar / Controls */}
      <div className="w-full md:w-[400px] flex-shrink-0 bg-blue-900 text-white flex flex-col h-full shadow-2xl z-20 relative">
        <div className="p-6 flex-grow overflow-y-auto custom-scrollbar flex flex-col">
          
          {/* Header */}
          <div className="mb-8 flex-shrink-0">
             <h1 className="text-xl font-bold tracking-tight text-white/90 uppercase leading-snug">
               CÔNG CỤ HỖ TRỢ NK12 - TIẾNG ANH
             </h1>
          </div>

          {/* SETTINGS VIEW BACK BUTTON */}
          {activeTab === 'settings' ? (
              <button
                onClick={handleBackClick}
                className="w-full mb-6 py-3 px-4 bg-blue-800 hover:bg-blue-700 text-white rounded-xl flex items-center gap-3 font-bold transition-all shadow-lg border border-blue-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Quay lại
              </button>
          ) : (
             <div className="grid grid-cols-3 gap-2 mb-6">
                {/* WORD TAB BUTTON */}
                <button
                    onClick={() => handleTabChange('word')}
                    className={`py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-1 font-bold text-[10px] transition-all ${activeTab === 'word' ? 'bg-white text-blue-900 shadow-lg' : 'bg-blue-800/50 text-blue-200 hover:bg-blue-800 hover:text-white'}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Word
                </button>
                {/* LATEX TAB BUTTON */}
                <button
                    onClick={() => handleTabChange('latex')}
                    className={`py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-1 font-bold text-[10px] transition-all ${activeTab === 'latex' ? 'bg-white text-blue-900 shadow-lg' : 'bg-blue-800/50 text-blue-200 hover:bg-blue-800 hover:text-white'}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                    LaTeX
                </button>
                {/* LATEX SHUFFLE BUTTON */}
                <button
                    onClick={() => handleTabChange('latex-shuffle')}
                    className={`py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-1 font-bold text-[10px] transition-all ${activeTab === 'latex-shuffle' ? 'bg-white text-blue-900 shadow-lg' : 'bg-blue-800/50 text-blue-200 hover:bg-blue-800 hover:text-white'}`}
                >
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    Trộn Đề
                </button>
             </div>
          )}

          {/* === CONTENT FOR CONVERTER (WORD OR LATEX OR SHUFFLE) === */}
          {activeTab !== 'settings' && (
            <div className="space-y-6 animate-fade-in-up">
              
              {/* Step 1: Upload / Paste */}
              <div>
                <div className="flex items-center gap-2 mb-2 text-blue-200 uppercase text-xs font-bold tracking-wider">
                  <span className="w-5 h-5 rounded-full border border-blue-300 flex items-center justify-center text-[10px]">1</span>
                  {activeTab === 'latex-shuffle' ? 'Tải lên File LaTeX gốc (.tex)' : 'Tải lên hoặc Dán nội dung'}
                </div>
                
                <label className="block w-full cursor-pointer group mb-3">
                  <div className={`
                    relative border-2 border-dashed rounded-xl p-6 transition-all duration-300
                    ${(file || pastedText) ? 'border-green-400 bg-green-500/20' : 'border-blue-400/30 hover:border-blue-300 hover:bg-blue-800/50'}
                  `}>
                    <input 
                      type="file" 
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      accept={activeTab === 'latex-shuffle' ? ".tex" : ".pdf,.png,.jpg,.jpeg"}
                      onChange={handleFileChange}
                    />
                    <div className="text-center space-y-2 pointer-events-none">
                      {file ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-base font-medium text-green-300 truncate px-2">{fileName}</p>
                          <p className="text-xs text-green-200/70">
                            {file.type === 'application/pdf' ? 'Đã nhận dạng PDF' : activeTab === 'latex-shuffle' ? 'File TeX sẵn sàng' : 'File ảnh đã sẵn sàng'}
                          </p>
                        </>
                      ) : pastedText ? (
                        <>
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p className="text-base font-medium text-green-300 px-2 line-clamp-2">{pastedText.substring(0, 50)}...</p>
                          <p className="text-xs text-green-200/70">Đã nhận nội dung văn bản</p>
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-blue-300/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-base font-medium text-blue-100">{activeTab === 'latex-shuffle' ? 'Chọn file .tex' : 'Chọn file PDF/Ảnh'}</p>
                          <p className="text-xs text-blue-300">Hoặc ấn <span className="font-bold text-white bg-blue-800 px-1 rounded">Ctrl + V</span> để dán</p>
                        </>
                      )}
                    </div>
                  </div>
                </label>
              </div>

              {/* Extra Inputs for Shuffle */}
              {activeTab === 'latex-shuffle' && (
                  <div>
                      <div className="flex items-center gap-2 mb-2 text-blue-200 uppercase text-xs font-bold tracking-wider">
                          <span className="w-5 h-5 rounded-full border border-blue-300 flex items-center justify-center text-[10px]">2</span>
                          Cấu hình trộn
                      </div>
                      <div className="space-y-3">
                          <div>
                              <label className="text-xs text-blue-300 block mb-1">Mã đề (cách nhau dấu phẩy)</label>
                              <input 
                                  type="text" 
                                  value={shuffleCodes}
                                  onChange={(e) => setShuffleCodes(e.target.value)}
                                  className="w-full bg-blue-800/30 border border-blue-600 rounded-lg p-2 text-white text-sm"
                                  placeholder="101, 102, 103"
                              />
                          </div>
                          <label className="flex items-center gap-2 text-sm text-white cursor-pointer select-none">
                              <input 
                                  type="checkbox" 
                                  checked={disableTFShuffle}
                                  onChange={(e) => setDisableTFShuffle(e.target.checked)}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              Không trộn câu hỏi Đúng/Sai (Giữ thứ tự a,b,c,d)
                          </label>
                      </div>
                  </div>
              )}
                
              {/* Action Buttons */}
              <div className="space-y-3 pt-6">
                    {/* Progress Bar */}
                    {isLoading && (
                        <div className="w-full bg-blue-950 rounded-full h-2.5 mb-2 border border-blue-800">
                            <div className="bg-green-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                        </div>
                    )}

                    {activeTab === 'latex-shuffle' ? (
                         <button
                            onClick={executeLatexShuffle}
                            disabled={isLoading || (!file && !pastedText)}
                            className={`w-full py-3.5 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all 
                                ${isLoading || (!file && !pastedText) ? 'bg-blue-950 text-blue-500 cursor-not-allowed border border-blue-800' : 'bg-yellow-500 hover:bg-yellow-400 text-blue-900 border border-yellow-500'}`}
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    <span>{loadingStatus || "Đang trộn..."}</span>
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                    <span>Trộn Đề Ngay</span>
                                </>
                            )}
                        </button>
                    ) : (
                        <>
                            {/* Button 1: Convert */}
                            <button
                            onClick={() => executeAction('convert')}
                            disabled={isLoading || (!file && !pastedText)}
                            className={`w-full py-3.5 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all 
                                ${isLoading || (!file && !pastedText) ? 'bg-blue-950 text-blue-500 cursor-not-allowed border border-blue-800' : 'bg-white hover:bg-blue-50 text-blue-900'}`}
                            >
                            {isLoading && loadingStatus ? (
                                <>
                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                <span className="text-sm truncate max-w-[200px]">{loadingStatus}</span>
                                </>
                            ) : (
                                <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                <span>Chuyển đổi sang {activeTab === 'word' ? 'Word' : 'LaTeX'}</span>
                                </>
                            )}
                            </button>
                            
                            {/* Button 2: Solve */}
                            <button
                            onClick={() => executeAction('solve')}
                            disabled={isLoading || (!file && !pastedText)}
                            className={`w-full py-3.5 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all 
                                ${isLoading || (!file && !pastedText) 
                                    ? 'bg-blue-950 text-blue-500 cursor-not-allowed border border-blue-800' 
                                    : 'bg-yellow-500 hover:bg-yellow-400 text-blue-900 border border-yellow-500'}`}
                            >
                            {isLoading && loadingStatus ? (
                                <>
                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                <span className="text-sm truncate max-w-[200px]">{loadingStatus}</span>
                                </>
                            ) : (
                                <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                <span>Tạo Hướng Dẫn Giải (Từ file)</span>
                                </>
                            )}
                            </button>
                        </>
                    )}
                </div>

            </div>
          )}

          {/* === CONTENT FOR SETTINGS === */}
          {activeTab === 'settings' && (
              <div className="space-y-6 animate-fade-in-up">
                  <div className="bg-blue-950/50 p-4 rounded-xl border border-blue-800/30">
                      <h3 className="text-white font-bold text-sm mb-3 border-b border-blue-800 pb-2">THÔNG TIN TÁC GIẢ</h3>
                      <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg">H</div>
                          <div>
                              <p className="text-white font-bold text-sm">Nguyễn Đức Hiền</p>
                              <p className="text-blue-300 text-xs">Giáo viên Vật Lí</p>
                          </div>
                      </div>
                      <p className="text-blue-200 text-xs leading-relaxed italic">
                          Trường THCS và THPT Nguyễn Khuyến Bình Dương.
                      </p>
                  </div>

                  <div className="bg-blue-950/50 p-4 rounded-xl border border-blue-800/30">
                    <h3 className="text-white font-bold text-sm mb-3 border-b border-blue-800 pb-2">CẤU HÌNH HỆ THỐNG</h3>
                    <label className="text-xs font-bold text-blue-300 uppercase mb-2 block flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                        Google Gemini API Key
                    </label>
                    
                    {/* Key Status Indicator */}
                    <div className={`text-[10px] font-bold mb-2 px-2 py-1 rounded inline-block border ${userApiKey ? 'bg-green-500/20 text-green-300 border-green-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'}`}>
                        {userApiKey ? "● Đang sử dụng Key cá nhân" : "● Đang sử dụng Key mặc định"}
                    </div>

                    <div className="relative">
                        <input 
                        type={showApiKey ? "text" : "password"}
                        value={userApiKey}
                        onChange={handleApiKeyChange}
                        placeholder="Dán API Key của bạn (nếu có)..."
                        className="w-full bg-blue-900/50 border border-blue-700/50 rounded-lg pl-3 pr-10 py-2 text-xs text-white placeholder-blue-500 focus:outline-none focus:border-blue-400 mb-1"
                        />
                        <button 
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-blue-400 hover:text-white"
                        >
                        {showApiKey ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                        </button>
                    </div>
                    <p className="text-[10px] text-blue-400 italic mt-1">Key được lưu trong trình duyệt của bạn.</p>
                  </div>

                  <div className="bg-blue-950/50 p-4 rounded-xl border border-blue-800/30">
                    <button 
                        onClick={() => setShowPackages(!showPackages)}
                        className="w-full flex justify-between items-center text-white font-bold text-sm mb-2 pb-2 border-b border-blue-800 hover:text-blue-300"
                    >
                        <span>CẤU HÌNH GÓI LỆNH OVERLEAF</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transform transition-transform ${showPackages ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    
                    {showPackages && (
                        <div className="space-y-4 animate-fade-in pt-2">
                             <p className="text-blue-200 text-xs italic">Tải lên các file .sty, .tex, .cls để tự động nhúng vào Overleaf.</p>
                             
                             <div className="relative border border-dashed border-blue-600 rounded-lg p-4 hover:bg-blue-900/30 transition-colors">
                                <input 
                                    type="file"
                                    multiple
                                    accept=".sty,.tex,.cls"
                                    onChange={handleCustomFileUpload}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                                <div className="text-center text-blue-300 text-xs">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mx-auto mb-1 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                    <p>Click để chọn file hoặc kéo thả vào đây</p>
                                </div>
                             </div>

                             {customFiles.length > 0 && (
                                 <div className="space-y-2 mt-3">
                                     <p className="text-xs font-bold text-white">Danh sách file đã lưu ({customFiles.length}):</p>
                                     <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                                        {customFiles.map((f, idx) => (
                                            <div key={idx} className="flex justify-between items-center bg-blue-900/50 p-2 rounded-lg border border-blue-800">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                    </svg>
                                                    <span className="text-xs text-blue-100 truncate">{f.name}</span>
                                                </div>
                                                <button 
                                                    onClick={() => handleDeleteCustomFile(f.name)}
                                                    className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/20"
                                                    title="Xóa file"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ))}
                                     </div>
                                 </div>
                             )}
                        </div>
                    )}
                  </div>
              </div>
          )}
          
          {error && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-sm font-medium">{error}</div>}

        </div>
        
        {/* BOTTOM: SETTINGS BUTTON & FOOTER */}
        <div className="p-4 bg-blue-950 text-blue-400 text-xs border-t border-blue-800">
           {/* Settings Trigger */}
           <button 
              onClick={handleSettingsClick}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-3 transition-colors ${activeTab === 'settings' ? 'bg-blue-800 text-white' : 'hover:bg-blue-900 text-blue-300'}`}
           >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="font-bold uppercase tracking-wider">Cài Đặt</span>
           </button>
           <div className="text-center font-medium">
             <p>© 2025 Converter NK12</p>
           </div>
        </div>
      </div>

      {/* RIGHT PANEL: Result Preview */}
      <div className="flex-1 bg-white h-full overflow-hidden flex flex-col relative font-sans">
        
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center z-10 min-h-[70px]">
          <h2 className="font-bold text-xl text-slate-800 flex items-center gap-2">
             {activeTab === 'settings' ? (
                <>
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                   Thông tin & Cài đặt
                </>
             ) : (
                <>
                   {activeTab === 'word' ? (
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                   ) : activeTab === 'latex' ? (
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                   ) : (
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                   )}
                   {isPreviewMode ? 'Xem trước kết quả (Chế độ đọc)' : `Kết quả ${activeTab === 'word' ? 'Word' : activeTab === 'latex-shuffle' ? 'Trộn Đề' : 'LaTeX'} (Chỉnh sửa được)`}
                </>
             )}
          </h2>
          
          <div className="flex gap-2">
            {isLoading && (
                 <button 
                    onClick={handleStop}
                    className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm flex items-center gap-2 transition-all"
                 >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    Dừng
                 </button>
            )}
            
            {(activeTab === 'word' || activeTab === 'latex' || activeTab === 'latex-shuffle') && resultContent && (
               <>
                 <button onClick={handleDownload} className="px-5 py-2.5 text-sm font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-sm flex items-center gap-2 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    {activeTab === 'word' ? 'Tải xuống Word' : 'Tải xuống .Tex'}
                 </button>
                 
                 {/* OVERLEAF BUTTON (Only show in LaTeX/Shuffle Tab) */}
                 {(activeTab === 'latex' || activeTab === 'latex-shuffle') && (
                     <button onClick={handleOpenOverleaf} className="px-5 py-2.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm flex items-center gap-2 transition-all">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                           <path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm0 2c5.514 0 10 4.486 10 10s-4.486 10-10 10-10-4.486-10-10 4.486-10 10-10zm-1.5 5l-4.5 9h3l1.5-3.5 1.5 3.5h3l-4.5-9h-3zm1.5 1.5l2 5h-4l2-5z"/>
                        </svg>
                        Chạy trên Overleaf
                     </button>
                 )}

                 <button onClick={handleCopy} className="px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm flex items-center gap-2 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                    Sao chép
                 </button>
                 <button onClick={() => setIsPreviewMode(!isPreviewMode)} className={`px-5 py-2.5 text-sm font-bold text-white rounded-lg shadow-sm flex items-center gap-2 transition-all ${isPreviewMode ? 'bg-gray-600 hover:bg-gray-700' : 'bg-purple-600 hover:bg-purple-700'}`}>
                    {isPreviewMode ? (
                        <>
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                           Chỉnh sửa
                        </>
                    ) : (
                        <>
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                           Xem trước
                        </>
                    )}
                 </button>
               </>
            )}
          </div>
        </div>

        {/* Scrollable Document Container */}
        <div className="flex-1 overflow-y-auto p-0 custom-scrollbar flex justify-center bg-white">
           <style>{`
                .generated-content { font-family: 'Be Vietnam Pro', 'Times New Roman', serif; }
                .generated-content table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 16px; border: 2px solid #000; }
                .generated-content th { border: 1px solid #000; padding: 10px; background-color: #003366; color: #ffffff; text-align: center; font-weight: bold; }
                .generated-content td { border: 1px solid #000; padding: 10px; text-align: center; color: #000; font-weight: bold; background-color: #f8fafc; }
                /* Custom MathJax spacing fix */
                .generated-content mjx-container { display: inline-block !important; margin: 0 !important; }
              `}</style>

           {/* VIEW FOR SETTINGS */}
           {activeTab === 'settings' && (
              <div className="w-full h-full bg-slate-50 flex items-center justify-center animate-fade-in-up p-8 overflow-y-auto">
                 <div className="bg-white max-w-2xl w-full rounded-2xl shadow-xl p-10 border border-blue-100 text-center">
                    <div className="w-24 h-24 bg-blue-600 text-white rounded-full flex items-center justify-center text-4xl font-bold mx-auto mb-6 shadow-lg">H</div>
                    <h2 className="text-3xl font-bold text-blue-900 mb-2">Nguyễn Đức Hiền</h2>
                    <p className="text-blue-500 font-semibold text-lg mb-6">Giáo viên Vật Lí</p>
                    <div className="h-1 w-24 bg-blue-100 mx-auto mb-6"></div>
                    <p className="text-gray-600 text-lg leading-relaxed mb-8">
                       Trường THCS và THPT Nguyễn Khuyến Bình Dương
                    </p>
                    <div className="bg-blue-50 rounded-xl p-6 border border-blue-100 text-sm text-blue-800">
                       <p className="font-semibold mb-2">Converter NK12</p>
                       <p>Công cụ chuyển đổi tài liệu thông minh sử dụng AI.</p>
                       <p className="mt-1">© 2025 Bản quyền thuộc về tác giả.</p>
                    </div>
                 </div>
              </div>
           )}

           {/* VIEW FOR CONVERSION RESULT (WORD OR LATEX) */}
           {activeTab !== 'settings' && (
              <div className="w-full h-full bg-white p-4 md:p-8 animate-fade-in-up">
                 
                 {/* 
                    MODE 1: EDIT MODE (ContentEditable) 
                 */}
                 {!isPreviewMode && (
                    <div 
                        ref={contentEditableRef}
                        contentEditable={true}
                        suppressContentEditableWarning={true}
                        onInput={handleContentChange}
                        onBlur={handleContentChange}
                        className={`generated-content prose prose-slate max-w-none w-full text-lg leading-relaxed text-gray-900 outline-none focus:ring-2 ring-blue-100 rounded-lg p-8 border border-gray-200 shadow-sm ${activeTab === 'latex' || activeTab === 'latex-shuffle' ? 'font-mono text-sm whitespace-pre-wrap' : ''}`}
                        style={{ minHeight: 'calc(100vh - 180px)' }}
                        dangerouslySetInnerHTML={{ __html: resultContent }}
                    >
                    </div>
                 )}

                 {/* 
                    MODE 2: PREVIEW MODE (Read-only + MathJax)
                    Renders HTML cleanly and triggers MathJax to format formulas.
                 */}
                 {isPreviewMode && (
                    <div 
                        className={`generated-content prose prose-slate max-w-none w-full text-lg leading-relaxed text-gray-900 p-8 border border-gray-100 ${activeTab === 'latex' || activeTab === 'latex-shuffle' ? 'font-mono text-sm whitespace-pre-wrap' : ''}`}
                        style={{ minHeight: 'calc(100vh - 180px)' }}
                        dangerouslySetInnerHTML={{ __html: resultContent }}
                    >
                    </div>
                 )}

                 {isLoading && (
                    <div className="mt-4 p-4 text-center text-blue-600 bg-blue-50 rounded-lg animate-pulse font-medium">
                       {loadingStatus || "Đang xử lý..."}
                    </div>
                 )}
                 {!resultContent && !isLoading && (
                    <div className="absolute top-[30%] left-0 w-full text-center pointer-events-none opacity-40">
                       <p className="text-xl text-slate-400 font-medium">Kết quả chuyển đổi sẽ hiển thị tại đây...</p>
                    </div>
                 )}
              </div>
           )}

        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
