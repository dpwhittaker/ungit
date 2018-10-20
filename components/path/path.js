
const ko = require('knockout');
const components = require('ungit-components');
const addressParser = require('ungit-address-parser');
const navigation = require('ungit-navigation');
const programEvents = require('ungit-program-events');

components.register('path', (args) => {
  return new PathViewModel(args.server, args.path);
});

class PathViewModel {
  constructor(server, path) {
    this.server = server;
    this.repoPath = ko.observable(path);
    this.dirName = this.repoPath().replace('\\', '/')
                     .split('/')
                     .filter((s) => s)
                     .slice(-1)[0] || '/';

    this.status = ko.observable('loading');
    this.cloneUrl = ko.observable();
    this.showDirectoryCreatedAlert = ko.observable(false);
    this.cloneDestinationImplicit = ko.computed(() => {
      const defaultText = 'destination folder';
      if (!this.cloneUrl()) return defaultText;

      const parsedAddress = addressParser.parseAddress(this.cloneUrl());
      return parsedAddress.shortProject || defaultText;
    });
    this.cloneDestination = ko.observable();
    this.repository = ko.observable();
    this.isRecursiveSubmodule = ko.observable(true);
		this.directories = ko.observableArray();
  }

  updateNode(parentElement) {
    ko.renderTemplate('path', this, {}, parentElement);
  }
  shown() { this.updateStatus(); }
  updateAnimationFrame(deltaT) {
    if (this.repository()) this.repository().updateAnimationFrame(deltaT);
  }
  updateStatus() {
    return this.server.getPromise('/quickstatus', { path: this.repoPath() })
      .then((status) => {
        if (status.type == 'inited' || status.type == 'bare') {
          if (this.repoPath() !== status.gitRootPath) {
            this.repoPath(status.gitRootPath);
            programEvents.dispatch({ event: 'navigated-to-path', path: this.repoPath() });
            programEvents.dispatch({ event: 'working-tree-changed' });
          }
          this.status(status.type);
          if (!this.repository()) {
            this.repository(components.create('repository', { server: this.server, path: this }));
          }
        } else if (status.type == 'uninited' || status.type == 'no-such-path') {
          this.status(status.type);
          this.repository(null);
					let promise = this.server.getPromise('/fs/listDirectories', {term: this.repoPath()}).then((directoryList) => {
          	const currentDir = directoryList.shift();
						let dirs = this.directories();
						let equals = (directoryList, i, d) => d.fullPath === directoryList[i];
						for (let i = 0; i < directoryList.length; i++) {
							if (!dirs.find(equals.bind(this, directoryList, i))) {
								let directory = directoryList[i].replace(currentDir + '/', '');
								dirs.push({
									fullPath: directoryList[i],
									directory: directory,
									branch: ko.observable(''),
									isAhead: ko.observable(false),
									ahead: ko.observable(0),
									isBehind: ko.observable(false),
									behind: ko.observable(0),
									status: ko.observable('')
								});
							}
						}
						this.directories(dirs);
						let fetch = (dir) => this.server.postPromise('/fetch', { path: dir.fullPath, remote: 'origin' });
						let status = (dir) => this.server.getPromise('/status', { path: dir.fullPath, fileLimit: 100 }).catch(e => ({error: e.error}));
						let update = (dir, status) => {
							let conflict = 0;
							let isNew = 0;
							let removed = 0;
							let renamed = 0;
							let staged = 0;
							let modified = 0;
							for (let filename in status.files) {
								let file = status.files[filename];
								if (file.conflict) conflict++;
								if (file.isNew) isNew++;
								if (file.removed) removed++;
								if (file.renamed) renamed++;
								if (file.staged) staged++;
								if (!file.conflict && !file.isNew && !file.removed && !file.renamed && !file.staged) modified++;
							}
							let statii = [];
							if (conflict) statii.push(conflict + ' conflicted');
							if (isNew) statii.push(isNew + ' new');
							if (removed) statii.push(removed + ' removed');
							if (renamed) statii.push(renamed + ' renamed');
							if (staged) statii.push(staged + ' staged');
							if (modified) statii.push(modified + ' modified');
							dir.branch(status.branch);
							dir.ahead(status.ahead);
							dir.isAhead(status.ahead > 0);
							dir.behind(status.behind);
							dir.isBehind(status.behind > 0);
							dir.status(statii.join(', ') || 'no changes');
						};
						for (let dir of dirs) {
							promise.then(fetch.bind(this, dir))
								.then(status.bind(this, dir))
					    	.then(update.bind(this, dir));
						}
					});
        }
        return null;
      }).catch((err) => { })
  }
  initRepository() {
    return this.server.postPromise('/init', { path: this.repoPath() })
      .catch((e) => this.server.unhandledRejection(e))
      .finally((res) => { this.updateStatus(); });
  }
  onProgramEvent(event) {
    if (event.event == 'working-tree-changed') this.updateStatus();
    else if (event.event == 'request-app-content-refresh') this.updateStatus();

    if (this.repository()) this.repository().onProgramEvent(event);
  }
	selectDirectory(directory) {
    navigation.browseTo(`repository?path=${encodeURIComponent(directory.fullPath)}`);		
	}
  cloneRepository() {
    this.status('cloning');
    const dest = this.cloneDestination() || this.cloneDestinationImplicit();

    return this.server.postPromise('/clone', { path: this.repoPath(), url: this.cloneUrl(), destinationDir: dest, isRecursiveSubmodule: this.isRecursiveSubmodule() })
      .then((res) => navigation.browseTo('repository?path=' + encodeURIComponent(res.path)) )
      .catch((e) => this.server.unhandledRejection(e))
      .finally(() => {
        programEvents.dispatch({ event: 'working-tree-changed' });
      })
  }
  createDir() {
    this.showDirectoryCreatedAlert(true);
    return this.server.postPromise('/createDir',  { dir: this.repoPath() })
      .catch((e) => this.server.unhandledRejection(e))
      .then(() => this.updateStatus());
  }
}
