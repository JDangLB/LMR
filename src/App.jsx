import React, { useState, useEffect } from 'react';
import { 
    Circle, CheckCircle2, Clock, Plus, Trash2, Edit3, X, 
    UploadCloud, File as FileIcon, Layers, Inbox, Calendar, 
    MousePointerClick, GitCommit, AlertTriangle, Loader2, Code, LogOut
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

// --- Constants ---
const DEPARTMENTS = ['Building', 'Planning', 'Public Works', 'Code Enforcement', 'Fire', 'Business License', 'Health', 'Uncategorized'];
const PROJECT_TYPES = ['Permitting/Licensing System Enhancement', 'Crystal Reports', 'SQL Data Extracts', 'Ad-Hoc Report', 'Inspector Gadget', 'Uncategorized'];
const CODE_LANGUAGES = ['Oracle SQL', 'VB .NET', 'Other'];

// --- Firebase Config Resolution ---
// LOCAL DEVELOPMENT: To use your local .env file, uncomment the VITE_... lines below 
// and comment out the empty strings.
const localConfig = {
     apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
     authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
     projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
     storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
     messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
     appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : localConfig;

let app;
let auth;
let db;
let storage;
let isFirebaseConfigured = false;

// Initialize Firebase safely only if valid credentials are present
if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "") {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        storage = getStorage(app);
        isFirebaseConfigured = true;
    } catch (error) {
        console.error("Firebase initialization failed:", error);
    }
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-local-app-id';

// --- Helper Components ---

const Icon = ({ name, className }) => {
    const icons = {
        'circle': Circle, 'check-circle-2': CheckCircle2, 'clock': Clock, 'plus': Plus,
        'trash-2': Trash2, 'edit-3': Edit3, 'x': X, 'upload-cloud': UploadCloud,
        'file': FileIcon, 'layers': Layers, 'inbox': Inbox, 'calendar': Calendar,
        'mouse-pointer-click': MousePointerClick, 'git-commit': GitCommit,
        'alert-triangle': AlertTriangle, 'loader-2': Loader2, 'code': Code, 'log-out': LogOut
    };
    const IconComponent = icons[name] || Circle;
    return <IconComponent className={className} />;
};

const PhaseIndicator = ({ phase, onClick }) => {
    let bgColor = "bg-slate-100", textColor = "text-slate-500", borderColor = "border-slate-200", iconName = "circle", iconColor = "";
    if (phase.status === "completed") {
        bgColor = "bg-green-50"; textColor = "text-green-700"; borderColor = "border-green-200"; iconName = "check-circle-2"; iconColor = "text-green-600";
    } else if (phase.status === "in-progress") {
        bgColor = "bg-blue-50"; textColor = "text-blue-700"; borderColor = "border-blue-200"; iconName = "clock"; iconColor = "text-blue-600";
    }
    return (
        <div onClick={onClick} className={`w-full text-left flex items-center p-4 border rounded-xl cursor-pointer hover:shadow-md transition-all ${bgColor} ${borderColor} ${textColor} group`}>
            <Icon name={iconName} className={`w-5 h-5 mr-3 flex-shrink-0 ${iconColor}`} />
            <div className="flex-1 overflow-hidden">
                <span className="font-semibold text-sm block">{phase.name}</span>
                {phase.notes && <span className="text-xs mt-0.5 opacity-70 truncate block">{phase.notes}</span>}
            </div>
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-white/60 px-2 py-1 rounded-md">{phase.status.replace('-', ' ')}</span>
        </div>
    );
};

const PhaseModal = ({ isOpen, onClose, phase, onSave, user }) => {
    const [editedPhase, setEditedPhase] = useState(phase);
    const [fileError, setFileError] = useState(null);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => { setEditedPhase(phase); setFileError(null); }, [phase]);
    if (!isOpen || !phase) return null;

    const handleChange = (e) => {
        const { name, value } = e.target;
        setEditedPhase(prev => ({ ...prev, [name]: value }));
    };

    const handleListChange = (listName, id, field, value) => {
        setEditedPhase(prev => ({
            ...prev,
            [listName]: (prev[listName] || []).map(item => item.id === id ? { ...item, [field]: value } : item)
        }));
    };

    const handleAddListItem = (listName, defaultItem) => {
        setEditedPhase(prev => ({
            ...prev,
            [listName]: [...(prev[listName] || []), defaultItem]
        }));
    };

    const handleRemoveListItem = async (listName, id) => {
        if (listName === 'attachments') {
            const attachmentToRemove = (editedPhase.attachments || []).find(a => a.id === id);
            if (attachmentToRemove && attachmentToRemove.storagePath) {
                try {
                    const fileRef = ref(storage, attachmentToRemove.storagePath);
                    await deleteObject(fileRef);
                } catch (error) {
                    console.error("Error deleting file from storage:", error);
                }
            }
        }
        setEditedPhase(prev => ({
            ...prev,
            [listName]: (prev[listName] || []).filter(item => item.id !== id)
        }));
    };

    const handleFileUpload = async (e) => {
        setFileError(null);
        const files = Array.from(e.target.files);
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        
        const validFiles = files.filter(file => {
            if (file.size > MAX_FILE_SIZE) { 
                setFileError(`The file "${file.name}" is too large. Maximum size is 50MB.`);
                return false;
            }
            return true;
        });

        if (validFiles.length === 0) return;
        setIsUploading(true);

        try {
            const newAttachments = [];
            for (const file of validFiles) {
                const fileId = Date.now() + Math.random().toString(36).substring(7);
                const storagePath = `artifacts/${appId}/users/${user?.uid}/attachments/${fileId}_${file.name}`;
                const storageRef = ref(storage, storagePath);
                
                const snapshot = await uploadBytes(storageRef, file);
                const downloadURL = await getDownloadURL(snapshot.ref);
                
                newAttachments.push({
                    id: fileId,
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    dataURL: downloadURL,
                    storagePath: storagePath
                });
            }
            setEditedPhase(prev => ({ ...prev, attachments: [...(prev.attachments || []), ...newAttachments] }));
        } catch (error) { 
            console.error("Upload Error:", error); 
            setFileError("An error occurred while uploading: " + error.message);
        } finally { 
            setIsUploading(false); 
        }
    };

    const renderPhaseSpecificFields = () => {
        switch(editedPhase.name) {
            case "Initiation":
                return (
                    <div className="space-y-4">
                        <div className="mt-4 pt-4 border-t border-slate-100">
                            <label className="block text-sm font-medium text-slate-700 mb-1">Project Initiated Date</label>
                            <input type="date" name="initiatedDate" value={editedPhase.initiatedDate || ''} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-[#0076bf] transition-shadow text-slate-700" />
                        </div>
                        
                        <div className="pt-2 border-t border-slate-100">
                            <label className="block text-sm font-medium text-slate-700 mb-1">Attachments</label>
                            <div className="flex items-center justify-center w-full relative">
                                <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-slate-300 border-dashed rounded-lg transition-colors group ${isUploading ? 'bg-slate-100 cursor-not-allowed' : 'bg-slate-50 hover:bg-[#0076bf]/5 hover:border-[#26d5fc] cursor-pointer'}`}>
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        <Icon name={isUploading ? "loader-2" : "upload-cloud"} className={`w-6 h-6 text-slate-400 mb-2 ${isUploading ? 'animate-spin text-[#0076bf]' : 'group-hover:text-[#26d5fc]'}`} />
                                        <p className="text-xs text-slate-500">
                                            {isUploading ? <span className="font-semibold text-[#0076bf]">Uploading...</span> : <><span className="font-semibold text-[#0076bf]">Click to upload</span> or drag and drop</>}
                                        </p>
                                        <p className="text-[10px] text-slate-400 mt-1">Max file size: 50MB</p>
                                    </div>
                                    <input type="file" className="hidden" multiple onChange={handleFileUpload} disabled={isUploading} />
                                </label>
                            </div>
                            
                            {fileError && <div className="text-red-600 text-xs mt-2 bg-red-50 p-2 rounded-md border border-red-100 font-medium">{fileError}</div>}
                            
                            <div className="mt-2 space-y-2">
                                {(editedPhase.attachments || []).map((file) => (
                                    <div key={file.id} className="flex justify-between items-center p-2.5 bg-white shadow-sm rounded-lg border border-slate-200">
                                        <div className="flex items-center overflow-hidden">
                                            <Icon name="file" className="w-4 h-4 text-[#0076bf] mr-2 flex-shrink-0" />
                                            <a href={file.dataURL} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-slate-700 hover:text-[#0076bf] truncate transition-colors" title="Download file">
                                                {file.name}
                                            </a>
                                            <span className="text-[10px] text-slate-400 ml-2">({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                                        </div>
                                        <button onClick={() => handleRemoveListItem('attachments', file.id)} disabled={isUploading} className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition-colors ml-2">
                                            <Icon name="trash-2" className="w-4 h-4"/>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case "Requirements":
                return (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-medium text-slate-700">Requirements Checklist</label>
                            <button onClick={() => handleAddListItem('requirementsList', { id: Date.now(), text: '', checked: false })} className="text-xs bg-[#0076bf]/10 text-[#0076bf] px-2 py-1.5 rounded hover:bg-[#0076bf]/20 font-medium flex items-center transition-colors"><Icon name="plus" className="w-3 h-3 mr-1"/> Add Requirement</button>
                        </div>
                        {(editedPhase.requirementsList || []).map((req) => (
                            <div key={req.id} className="flex items-center gap-3 bg-slate-50/80 p-2.5 rounded-lg border border-slate-200 shadow-sm">
                                <input type="checkbox" checked={req.checked || false} onChange={e => handleListChange('requirementsList', req.id, 'checked', e.target.checked)} className="w-4 h-4 text-[#0076bf] rounded border-slate-300 focus:ring-[#0076bf] cursor-pointer" />
                                <input type="text" value={req.text || ''} onChange={e => handleListChange('requirementsList', req.id, 'text', e.target.value)} placeholder="Describe requirement..." className="flex-1 bg-transparent border-none focus:ring-0 text-sm outline-none p-1" />
                                <button onClick={() => handleRemoveListItem('requirementsList', req.id)} className="text-slate-400 hover:text-red-500 p-1 transition-colors"><Icon name="trash-2" className="w-4 h-4"/></button>
                            </div>
                        ))}
                    </div>
                );
            case "Planning":
                return (
                    <div className="space-y-6">
                        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-sm font-medium text-slate-700">Planning Procedures</label>
                                <button onClick={() => handleAddListItem('proceduresList', { id: Date.now(), text: '' })} className="text-xs bg-[#0076bf]/10 text-[#0076bf] px-2 py-1.5 rounded hover:bg-[#0076bf]/20 font-medium flex items-center transition-colors"><Icon name="plus" className="w-3 h-3 mr-1"/> Add Procedure</button>
                            </div>
                            {(editedPhase.proceduresList || []).map((proc, index) => (
                                <div key={proc.id} className="flex items-center gap-3 bg-slate-50/80 p-2.5 rounded-lg border border-slate-200 shadow-sm">
                                    <span className="text-xs font-bold text-slate-400 w-5 text-center bg-white rounded border border-slate-200 py-1">{index + 1}</span>
                                    <input type="text" value={proc.text || ''} onChange={e => handleListChange('proceduresList', proc.id, 'text', e.target.value)} placeholder="Enter procedure step..." className="flex-1 bg-transparent border-none focus:ring-0 text-sm outline-none p-1" />
                                    <button onClick={() => handleRemoveListItem('proceduresList', proc.id)} className="text-slate-400 hover:text-red-500 p-1 transition-colors"><Icon name="trash-2" className="w-4 h-4"/></button>
                                </div>
                            ))}
                        </div>
                        
                        <div className="pt-4 border-t border-slate-100 space-y-3">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-sm font-medium text-slate-700">Code Snippets</label>
                                <button onClick={() => handleAddListItem('codeSnippets', { id: Date.now(), language: 'Oracle SQL', code: '' })} className="text-xs bg-[#0076bf]/10 text-[#0076bf] px-2 py-1.5 rounded hover:bg-[#0076bf]/20 font-medium flex items-center transition-colors"><Icon name="plus" className="w-3 h-3 mr-1"/> Add Code</button>
                            </div>
                            {(editedPhase.codeSnippets || []).map((snippet) => (
                                <div key={snippet.id} className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                                    <div className="flex justify-between items-center bg-slate-100 px-3 py-2 border-b border-slate-200">
                                        <div className="flex items-center gap-2">
                                            <Icon name="code" className="w-4 h-4 text-[#0076bf]" />
                                            <select 
                                                value={snippet.language} 
                                                onChange={e => handleListChange('codeSnippets', snippet.id, 'language', e.target.value)}
                                                className="text-xs font-semibold text-slate-700 bg-transparent border-none outline-none focus:ring-0 p-0 cursor-pointer"
                                            >
                                                {CODE_LANGUAGES.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                                            </select>
                                        </div>
                                        <button onClick={() => handleRemoveListItem('codeSnippets', snippet.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1"><Icon name="trash-2" className="w-3.5 h-3.5"/></button>
                                    </div>
                                    <textarea 
                                        value={snippet.code || ''} 
                                        onChange={e => handleListChange('codeSnippets', snippet.id, 'code', e.target.value)} 
                                        placeholder="Paste your code here..." 
                                        className="w-full bg-slate-900 text-green-400 font-mono text-xs p-3 outline-none focus:ring-0 border-none resize-y min-h-[120px]"
                                        spellCheck={false}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case "Testing":
                return (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Test Environment</label>
                        <input type="text" name="testEnvironment" value={editedPhase.testEnvironment || ''} onChange={handleChange} placeholder="e.g., Staging, UAT, QA-1" className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-[#0076bf] transition-shadow text-slate-700" />
                    </div>
                );
            case "Closing":
                return (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Deliverables</label>
                            <textarea name="deliverables" value={editedPhase.deliverables || ''} onChange={handleChange} rows="3" placeholder="List final deliverables here..." className="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-[#0076bf] transition-shadow resize-none text-slate-700" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Project Completion Date</label>
                            <input type="date" name="completionDate" value={editedPhase.completionDate || ''} onChange={handleChange} className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-[#0076bf] transition-shadow text-slate-700" />
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-5 border-b bg-slate-50/50">
                    <h2 className="text-xl font-semibold">Edit {editedPhase.name}</h2>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><Icon name="x" className="w-5 h-5" /></button>
                </div>
                <div className="p-6 flex-1 overflow-y-auto space-y-5 custom-scrollbar">
                    <label className="block text-sm font-medium">Status</label>
                    <select name="status" value={editedPhase.status} onChange={handleChange} className="w-full border rounded-lg p-2.5">
                        <option value="pending">Pending</option>
                        <option value="in-progress">In Progress</option>
                        <option value="completed">Completed</option>
                    </select>
                    <label className="block text-sm font-medium">Notes</label>
                    <textarea name="notes" value={editedPhase.notes || ''} onChange={handleChange} rows="3" className="w-full border rounded-lg p-3 resize-none" placeholder="Phase notes..." />
                    
                    {renderPhaseSpecificFields()}
                </div>
                <div className="p-5 border-t flex justify-end space-x-3 bg-slate-50/50 rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 bg-slate-100 rounded-lg">Cancel</button>
                    <button onClick={() => onSave(editedPhase)} disabled={isUploading} className="px-4 py-2 bg-[#0076bf] text-white rounded-lg">
                        {isUploading ? 'Uploading...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const LoginScreen = ({ onSignIn, error }) => (
    <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="bg-white p-10 rounded-2xl shadow-xl max-w-sm w-full text-center">
            <Icon name="layers" className="w-12 h-12 text-[#0076bf] mx-auto mb-6" />
            <h1 className="text-2xl font-bold mb-8">Projects & Tasks</h1>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">{error}</div>}
            <button onClick={onSignIn} className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 py-2.5 rounded-xl hover:bg-slate-50 transition-all shadow-sm">
                Sign in with Google
            </button>
        </div>
    </div>
);

const SetupGuideScreen = () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-xl w-full border border-slate-200">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-6">
                <Icon name="alert-triangle" className="w-6 h-6 text-[#0076bf]" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">Firebase Setup Required</h1>
            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
                Your local environment is running, but Firebase has not been configured yet. Follow these steps to load your environment variables securely:
            </p>
            
            <div className="space-y-4 mb-6">
                <div className="flex gap-3">
                    <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">1</span>
                    <p className="text-xs text-slate-600 mt-0.5">
                        Create a file named <strong className="font-semibold text-slate-800">.env</strong> in your root directory (the same folder as <code className="bg-slate-100 px-1 py-0.5 rounded">package.json</code>).
                    </p>
                </div>
                <div className="flex gap-3">
                    <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">2</span>
                    <div className="space-y-2 w-full">
                        <p className="text-xs text-slate-600 mt-0.5">
                            Paste your Firebase keys inside using this exact format (no quotes needed):
                        </p>
                        <pre className="bg-slate-900 text-slate-300 font-mono text-[11px] p-4 rounded-lg overflow-x-auto select-all shadow-inner w-full">
{`VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id`}
                        </pre>
                    </div>
                </div>
                <div className="flex gap-3">
                    <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">3</span>
                    <p className="text-xs text-slate-600 mt-0.5">
                        Stop your server (<kbd className="bg-slate-100 px-1.5 py-0.5 border rounded text-[10px]">Ctrl + C</kbd>) and restart it using <code className="bg-slate-100 px-1 py-0.5 rounded font-semibold text-slate-800">npm run dev</code>.
                    </p>
                </div>
            </div>
            
            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
                <p className="text-[11px] text-[#0076bf] font-medium leading-relaxed">
                    💡 Note: This screen will automatically hide, and the login page will render as soon as your local environment loads valid configuration keys.
                </p>
            </div>
        </div>
    </div>
);

export default function App() {
    if (!isFirebaseConfigured) {
        return <SetupGuideScreen />;
    }

    const [user, setUser] = useState(null);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState(null);
    const [activeTab, setActiveTab] = useState('ongoing');
    const [selectedProjectId, setSelectedProjectId] = useState(null);
    const [editingPhaseInfo, setEditingPhaseInfo] = useState(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const [sidebarDeleteConfirmId, setSidebarDeleteConfirmId] = useState(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!user) return;
        const projectsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'projects');
        return onSnapshot(projectsRef, (snapshot) => {
            const projectData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Sort newest first
            projectData.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
            setProjects(projectData);
        });
    }, [user]);

    const filteredProjects = projects.filter(p => p.status === activeTab);
    const selectedProject = projects.find(p => p.id === selectedProjectId);

    useEffect(() => {
        if (filteredProjects.length > 0 && (!selectedProject || selectedProject.status !== activeTab)) {
            setSelectedProjectId(filteredProjects[0].id);
        } else if (filteredProjects.length === 0) {
             setSelectedProjectId(null);
        }
    }, [activeTab, projects.length]);

    const handleGoogleLogin = async () => {
        try {
            setAuthError(null);
            await setPersistence(auth, browserLocalPersistence);
            await signInWithPopup(auth, new GoogleAuthProvider());
        } catch (error) { setAuthError(error.message); }
    };

    const handleAddProject = async () => {
        const newProject = {
            title: "New Project", 
            status: activeTab, 
            department: "Uncategorized", 
            projectType: "Uncategorized", 
            description: "Edit description...",
            createdAt: serverTimestamp(),
            phases: [
                { name: "Initiation", status: "pending", notes: "", initiatedDate: "", attachments: [] },
                { name: "Requirements", status: "pending", notes: "", requirementsList: [] },
                { name: "Planning", status: "pending", notes: "", proceduresList: [], codeSnippets: [] },
                { name: "Execution", status: "pending", notes: "" },
                { name: "Testing", status: "pending", notes: "", testEnvironment: "" },
                { name: "Closing", status: "pending", notes: "", deliverables: "", completionDate: "" }
            ]
        };
        const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'projects'), newProject);
        setSelectedProjectId(docRef.id);
    };

    const handleProjectUpdate = async (field, value) => {
        if (!selectedProjectId) return;
        setProjects(prev => prev.map(p => p.id === selectedProjectId ? { ...p, [field]: value } : p));
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'projects', selectedProjectId), { [field]: value });
    };

    const handleDeleteProject = async (id) => {
        if (!user) return;
        try {
            const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'projects', id);
            await deleteDoc(docRef);
            if (selectedProjectId === id) setSelectedProjectId(null);
            setDeleteConfirmId(null);
            setSidebarDeleteConfirmId(null);
        } catch (error) {
            console.error("Error deleting project: ", error);
        }
    };

    const handleSavePhase = async (updatedPhase) => {
        const proj = projects.find(p => p.id === editingPhaseInfo.projectId);
        const updatedPhases = [...proj.phases];
        updatedPhases[editingPhaseInfo.phaseIndex] = updatedPhase;

        let updatedStatus = proj.status;
        const allCompleted = updatedPhases.every(p => p.status === 'completed');
        
        if (allCompleted && proj.status !== 'completed') {
            updatedStatus = 'completed';
            const closingPhaseIndex = updatedPhases.findIndex(p => p.name === 'Closing');
            if (closingPhaseIndex > -1 && !updatedPhases[closingPhaseIndex].completionDate) {
                updatedPhases[closingPhaseIndex].completionDate = new Date().toISOString().split('T')[0];
            }
        } else if (!allCompleted && proj.status === 'completed') {
            updatedStatus = 'ongoing';
        }

        setProjects(prev => prev.map(p => p.id === proj.id ? { ...p, phases: updatedPhases, status: updatedStatus } : p));
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'projects', proj.id), { 
            phases: updatedPhases,
            status: updatedStatus
        });
        setEditingPhaseInfo(null);
    };

    // Grouping Sidebar Items
    const groupedProjects = filteredProjects.reduce((acc, project) => {
        const dept = project.department || 'Uncategorized';
        const type = project.projectType || 'Uncategorized';
        if (!acc[dept]) acc[dept] = {};
        if (!acc[dept][type]) acc[dept][type] = [];
        acc[dept][type].push(project);
        return acc;
    }, {});

    const sortedDepartments = Object.keys(groupedProjects).sort();

    const groupedCompleted = projects.filter(p => p.status === 'completed').reduce((acc, project) => {
        const closingPhase = project.phases.find(p => p.name === 'Closing');
        const date = closingPhase?.completionDate || 'No Date Specified';
        if (!acc[date]) acc[date] = [];
        acc[date].push(project);
        return acc;
    }, {});

    const sortedDates = Object.keys(groupedCompleted).sort((a, b) => {
        if (a === 'No Date Specified') return 1;
        if (b === 'No Date Specified') return -1;
        return new Date(b) - new Date(a);
    });

    const renderProjectCard = (project) => (
        <div
            key={project.id}
            onClick={() => setSelectedProjectId(project.id)}
            className={`w-full text-left p-4 rounded-xl transition-all border relative group cursor-pointer ${
                selectedProjectId === project.id 
                ? 'bg-[#0076bf]/10 border-[#0076bf]/30 shadow-sm' 
                : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'
            }`}
        >
            <div className="flex justify-between items-start mb-1">
                <h3 className={`font-semibold truncate pr-8 ${selectedProjectId === project.id ? 'text-[#003359]' : 'text-slate-800'}`}>
                    {project.title}
                </h3>
            </div>
            <p className="text-xs text-slate-500 truncate">{project.description}</p>
            
            <div className="absolute top-3 right-3" onClick={(e) => e.stopPropagation()}>
                {sidebarDeleteConfirmId === project.id ? (
                    <div className="flex items-center gap-1 bg-red-50 p-1 rounded border border-red-200">
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }} className="px-2 py-1 bg-red-600 text-white rounded text-[10px] font-bold">Yes</button>
                        <button onClick={(e) => { e.stopPropagation(); setSidebarDeleteConfirmId(null); }} className="px-2 py-1 bg-white text-slate-600 rounded text-[10px] font-bold border border-slate-200">No</button>
                    </div>
                ) : (
                    <button 
                        onClick={(e) => { e.stopPropagation(); setSidebarDeleteConfirmId(project.id); }}
                        className={`p-1.5 text-slate-400 hover:text-red-500 rounded-md ${selectedProjectId === project.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                        title="Delete Project"
                    >
                        <Icon name="trash-2" className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );

    if (loading) return <div className="h-screen flex items-center justify-center"><Icon name="loader-2" className="animate-spin w-10 h-10 text-blue-500" /></div>;
    if (!user) return <LoginScreen onSignIn={handleGoogleLogin} error={authError} />;

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden">
            
            {/* Sidebar */}
            <div className="w-80 bg-white border-r flex flex-col z-10">
                <div className="p-6 border-b flex justify-between items-center bg-slate-50/50">
                    <h1 className="font-bold flex items-center text-lg"><Icon name="layers" className="w-5 h-5 mr-2 text-blue-600" /> Projects</h1>
                    <button onClick={handleAddProject} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"><Icon name="plus" className="w-4 h-4" /></button>
                </div>

                <div className="flex px-4 pt-4 border-b gap-4 bg-white">
                    <button 
                        onClick={() => setActiveTab('ongoing')}
                        className={`pb-3 px-2 font-medium text-sm border-b-2 ${activeTab === 'ongoing' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}
                    >
                        Ongoing
                        <span className="ml-2 bg-slate-100 text-slate-600 py-0.5 px-2 rounded-full text-xs font-bold">
                            {projects.filter(p=>p.status==='ongoing').length}
                        </span>
                    </button>
                    <button 
                        onClick={() => setActiveTab('completed')}
                        className={`pb-3 px-2 font-medium text-sm border-b-2 ${activeTab === 'completed' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}
                    >
                        Completed
                         <span className="ml-2 bg-slate-100 text-slate-600 py-0.5 px-2 rounded-full text-xs font-bold">
                            {projects.filter(p=>p.status==='completed').length}
                        </span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 bg-slate-50/30">
                    {filteredProjects.length === 0 ? (
                        <div className="text-center py-12 px-6 flex flex-col items-center">
                            <Icon name="inbox" className="w-8 h-8 text-slate-400 mb-4" />
                            <p className="text-slate-600 font-medium mb-1">No {activeTab} projects</p>
                        </div>
                    ) : activeTab === 'ongoing' ? (
                        sortedDepartments.map(dept => (
                            <div key={dept} className="mb-6 last:mb-0">
                                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3 px-1 border-b pb-1 flex items-center">
                                    <Icon name="layers" className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                                    {dept}
                                </h4>
                                {Object.keys(groupedProjects[dept]).sort().map(type => (
                                    <div key={type} className="mb-4 pl-2">
                                        <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center">
                                            <Icon name="git-commit" className="w-3 h-3 mr-1" />
                                            {type}
                                        </h5>
                                        <div className="space-y-3 border-l-2 pl-3 border-slate-100">
                                            {groupedProjects[dept][type].map(renderProjectCard)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))
                    ) : (
                        sortedDates.map(date => (
                            <div key={date} className="mb-6 last:mb-0">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 px-1 border-b pb-1 flex items-center">
                                    <Icon name="calendar" className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                                    {date}
                                </h4>
                                <div className="space-y-3">
                                    {groupedCompleted[date].map(renderProjectCard)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <button onClick={() => signOut(auth)} className="p-4 text-slate-400 hover:text-red-500 text-sm flex items-center border-t"><Icon name="log-out" className="w-4 h-4 mr-2" /> Sign Out</button>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
                
                {selectedProject ? (
                    <div className="max-w-4xl mx-auto p-12 relative z-10">
                        <div className="mb-10 bg-white p-8 rounded-2xl shadow-sm border relative group">
                            <div className="absolute top-8 right-8 flex items-center gap-2">
                                {deleteConfirmId === selectedProject.id ? (
                                    <div className="flex items-center gap-2 bg-red-50 p-1.5 rounded-lg border border-red-200">
                                        <span className="text-xs text-red-600 font-medium px-2">Delete Project?</span>
                                        <button onClick={() => handleDeleteProject(selectedProject.id)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-medium">Yes</button>
                                        <button onClick={() => setDeleteConfirmId(null)} className="px-3 py-1.5 bg-white text-slate-600 rounded-md text-xs font-medium border border-slate-200">No</button>
                                    </div>
                                ) : (
                                    <button 
                                        onClick={() => setDeleteConfirmId(selectedProject.id)}
                                        className="p-2.5 text-slate-400 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100"
                                        title="Delete Project"
                                    >
                                        <Icon name="trash-2" className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                            
                            <div className="flex justify-between items-start mb-4 pr-40">
                                <input 
                                    value={selectedProject.title} 
                                    onChange={(e) => handleProjectUpdate('title', e.target.value)} 
                                    className="text-3xl font-bold w-full bg-transparent outline-none border-b border-transparent focus:border-slate-200 py-1"
                                    placeholder="Project Title"
                                />
                                <span className={`px-3 py-1.5 text-[11px] font-bold rounded-full uppercase tracking-wider ${
                                    selectedProject.status === 'completed' 
                                    ? 'bg-green-100 text-green-800 border border-green-200' 
                                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                                }`}>
                                    {selectedProject.status}
                                </span>
                            </div>
                            <textarea 
                                value={selectedProject.description} 
                                onChange={(e) => handleProjectUpdate('description', e.target.value)} 
                                className="w-full text-slate-600 bg-transparent outline-none resize-none border-b border-transparent focus:border-slate-200 py-1" 
                                rows="2"
                                placeholder="Edit project description..."
                            />
                            
                            <div className="mt-4 flex flex-col sm:flex-row gap-4">
                                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border shadow-sm flex-1">
                                    <Icon name="layers" className="w-4 h-4 text-slate-400" />
                                    <select
                                        value={selectedProject.department || 'Uncategorized'}
                                        onChange={(e) => handleProjectUpdate('department', e.target.value)}
                                        className="text-sm font-medium text-blue-600 bg-transparent border-none outline-none focus:ring-0 p-0 cursor-pointer w-full"
                                    >
                                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border shadow-sm flex-1">
                                    <Icon name="git-commit" className="w-4 h-4 text-slate-400" />
                                    <select
                                        value={selectedProject.projectType || 'Uncategorized'}
                                        onChange={(e) => handleProjectUpdate('projectType', e.target.value)}
                                        className="text-sm font-medium text-blue-600 bg-transparent border-none outline-none focus:ring-0 p-0 cursor-pointer w-full"
                                    >
                                        {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center bg-white py-2 px-4 rounded-xl border shadow-sm inline-flex">
                                <Icon name="git-commit" className="w-5 h-5 mr-2 text-blue-500" />
                                Project Lifecycle
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                {selectedProject.phases.map((phase, idx) => (
                                    <PhaseIndicator key={idx} phase={phase} onClick={() => setEditingPhaseInfo({ projectId: selectedProject.id, phaseIndex: idx, phase })} />
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                        <Icon name="mouse-pointer-click" className="w-12 h-12 mb-4 opacity-20" />
                        <p>Select a project to view details</p>
                    </div>
                )}
            </div>

            {editingPhaseInfo && (
                <PhaseModal isOpen={true} onClose={() => setEditingPhaseInfo(null)} phase={editingPhaseInfo.phase} onSave={handleSavePhase} user={user} />
            )}
        </div>
    );
}