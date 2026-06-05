// Feature 5: Task templates — pre-written ML workflow prompts

const TEMPLATES = [
  {
    category: 'Training',
    icon: 'run',
    name: 'Train classifier',
    desc: 'Image classification with PyTorch',
    template: `Train an image classifier on {dataset} using {architecture} (e.g. ResNet-18).
Use mixed precision (torch.cuda.amp), batch size {batch_size}, learning rate {lr}, {epochs} epochs.
Include: train/val split, loss + accuracy logging each epoch, save best checkpoint to /workspace/checkpoints/best.pt.
Print a summary table of metrics at the end.`,
    params: [
      { id: 'dataset', label: 'Dataset path or name', placeholder: '/workspace/data or CIFAR10' },
      { id: 'architecture', label: 'Architecture', placeholder: 'ResNet-18' },
      { id: 'epochs', label: 'Epochs', placeholder: '20' },
      { id: 'batch_size', label: 'Batch size', placeholder: '64' },
      { id: 'lr', label: 'Learning rate', placeholder: '1e-3' },
    ],
  },
  {
    category: 'Training',
    icon: 'run',
    name: 'Fine-tune LLM',
    desc: 'LoRA fine-tuning with HuggingFace',
    template: `Fine-tune {model} on the dataset at {data_path} using LoRA (rank={lora_r}, alpha={lora_alpha}).
Use the HuggingFace transformers + peft libraries. Training: {epochs} epochs, lr={lr}, batch size {batch_size}.
Save the LoRA adapter to /workspace/lora_output/. Log loss every 10 steps.
If the dataset is not in the right format, preprocess it first.`,
    params: [
      { id: 'model', label: 'Base model', placeholder: 'meta-llama/Llama-3.2-1B or mistralai/Mistral-7B-v0.1' },
      { id: 'data_path', label: 'Dataset path', placeholder: '/workspace/data/train.jsonl' },
      { id: 'epochs', label: 'Epochs', placeholder: '3' },
      { id: 'lr', label: 'Learning rate', placeholder: '2e-4' },
      { id: 'batch_size', label: 'Batch size', placeholder: '4' },
      { id: 'lora_r', label: 'LoRA rank', placeholder: '16' },
      { id: 'lora_alpha', label: 'LoRA alpha', placeholder: '32' },
    ],
  },
  {
    category: 'Evaluation',
    icon: 'tasks',
    name: 'Evaluate model',
    desc: 'Run evaluation on a test set',
    template: `Evaluate the model checkpoint at {checkpoint_path} on the test set at {test_data}.
Compute: accuracy, precision, recall, F1, and confusion matrix.
Save results as JSON to /workspace/eval_results.json and print a formatted table.
Use {batch_size} batch size for inference.`,
    params: [
      { id: 'checkpoint_path', label: 'Checkpoint path', placeholder: '/workspace/checkpoints/best.pt' },
      { id: 'test_data', label: 'Test data path', placeholder: '/workspace/data/test' },
      { id: 'batch_size', label: 'Batch size', placeholder: '128' },
    ],
  },
  {
    category: 'Search',
    icon: 'settings',
    name: 'Hyperparameter sweep',
    desc: 'Grid search over key hyperparameters',
    template: `Run a hyperparameter sweep over learning rates {lr_values} and batch sizes {batch_values}.
For each combination, train for {epochs} quick epochs and record val loss.
Save all results to /workspace/sweep_results.json.
Print a ranked table of best configurations at the end.`,
    params: [
      { id: 'lr_values', label: 'Learning rates', placeholder: '1e-3, 5e-4, 1e-4' },
      { id: 'batch_values', label: 'Batch sizes', placeholder: '32, 64, 128' },
      { id: 'epochs', label: 'Epochs per run', placeholder: '5' },
    ],
  },
  {
    category: 'Data',
    icon: 'files',
    name: 'Explore dataset',
    desc: 'Analyze and visualize a dataset',
    template: `Explore the dataset at {data_path}.
Compute: number of samples, class distribution, image sizes (if vision), sequence length stats (if text).
Check for: duplicates, corrupted files, class imbalance.
Save a summary report to /workspace/dataset_report.txt.`,
    params: [
      { id: 'data_path', label: 'Dataset path', placeholder: '/workspace/data' },
    ],
  },
  {
    category: 'Data',
    icon: 'files',
    name: 'Preprocess data',
    desc: 'Clean and prepare training data',
    template: `Preprocess the raw data at {raw_path} and save to {output_path}.
Steps: {steps}
Ensure the output format is ready for training (proper splits: train/val/test at 80/10/10).
Print statistics about the processed dataset.`,
    params: [
      { id: 'raw_path', label: 'Raw data path', placeholder: '/workspace/raw_data' },
      { id: 'output_path', label: 'Output path', placeholder: '/workspace/data' },
      { id: 'steps', label: 'Preprocessing steps', placeholder: 'normalize images, augment with random crops and flips' },
    ],
  },
  {
    category: 'Utilities',
    icon: 'terminal',
    name: 'Install requirements',
    desc: 'Install packages from requirements.txt',
    template: `Install all packages listed in {requirements_file}.
After installing, verify each import works by running a quick test script.
Report any packages that failed to install and suggest alternatives.`,
    params: [
      { id: 'requirements_file', label: 'Requirements file', placeholder: '/workspace/requirements.txt' },
    ],
  },
  {
    category: 'Utilities',
    icon: 'save',
    name: 'Profile GPU memory',
    desc: 'Find memory bottlenecks in training code',
    template: `Profile the GPU memory usage of the training script at {script_path}.
Find the peak memory allocation, identify the largest tensors, and suggest optimizations:
- Gradient checkpointing
- Mixed precision
- Reduced batch size
- Memory-efficient attention
Report current usage and estimated savings from each optimization.`,
    params: [
      { id: 'script_path', label: 'Training script path', placeholder: '/workspace/train.py' },
    ],
  },
];

function openTemplatesModal() {
  const overlay = document.createElement('div');
  overlay.id = 'templates-modal';
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'z-index:250';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const categories = [...new Set(TEMPLATES.map(t => t.category))];

  overlay.innerHTML = `
    <div class="modal" style="max-width:680px;width:95vw">
      <div style="display:flex;align-items:center;margin-bottom:14px">
        <h2 style="flex:1;margin:0">Task Templates</h2>
        <button class="btn btn-ghost" onclick="document.getElementById('templates-modal').remove()">Close</button>
      </div>
      <div id="tmpl-list" style="display:flex;flex-direction:column;gap:4px;max-height:70vh;overflow-y:auto">
        ${categories.map(cat => `
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--fg-dim);padding:8px 4px 4px">${cat}</div>
          ${TEMPLATES.filter(t => t.category === cat).map((t,i) => `
            <div class="tmpl-card" onclick="Templates.selectTemplate(${TEMPLATES.indexOf(t)})">
              <div class="tmpl-icon">${svgIcon(t.icon)}</div>
              <div class="tmpl-body">
                <div class="tmpl-name">${esc(t.name)}</div>
                <div class="tmpl-desc">${esc(t.desc)}</div>
              </div>
              <div class="tmpl-arrow">${svgIcon('chevron-right')}</div>
            </div>`).join('')}
        `).join('')}
      </div>
    </div>`;

  document.body.appendChild(overlay);
}

const Templates = {
  selectTemplate(idx) {
    const t = TEMPLATES[idx];
    if (!t) return;

    // Replace modal content with parameter form
    const modal = document.querySelector('#templates-modal .modal');
    if (!modal) return;

    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <button class="btn btn-ghost" style="padding:3px 8px" onclick="openTemplatesModal();document.getElementById('templates-modal').remove()">← Back</button>
        <h2 style="flex:1;margin:0">${esc(t.name)}</h2>
      </div>
      <div style="font-size:12px;color:var(--fg-muted);margin-bottom:14px">${esc(t.desc)}</div>
      ${t.params.map(p => `
        <label class="modal-label">${esc(p.label)}</label>
        <input class="modal-input" id="tp-${p.id}" placeholder="${esc(p.placeholder)}" value="${esc(p.placeholder.split(' or ')[0])}"/>
      `).join('')}
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('templates-modal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="Templates.useTemplate(${idx})">Use Template</button>
      </div>`;
  },

  useTemplate(idx) {
    const t = TEMPLATES[idx];
    if (!t) return;
    let task = t.template;
    t.params.forEach(p => {
      const el = document.getElementById(`tp-${p.id}`);
      if (el) task = task.replace(new RegExp(`\\{${p.id}\\}`, 'g'), el.value || p.placeholder);
    });
    document.getElementById('templates-modal')?.remove();
    openNewTaskModal();
    setTimeout(() => {
      const ta = document.getElementById('nti-task');
      if (ta) ta.value = task;
    }, 50);
  },
};

window.openTemplatesModal = openTemplatesModal;
window.Templates = Templates;