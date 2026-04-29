import { AppViewModel } from '../viewmodel/AppViewModel';
import { Task, TaskFilter } from '../model/DataModels';
import promptAction from '@ohos.promptAction';

@Entry
@Component
struct TaskPage {
  @State tasks: Task[] = [];
  @State currentFilter: TaskFilter = 'all';
  @State newTaskTitle: string = '';
  @State isLoading: boolean = false;
  @State taskStats: { total: number; completed: number; pending: number; today: number; overdue: number } = {
    total: 0, completed: 0, pending: 0, today: 0, overdue: 0
  };
  private viewModel: AppViewModel = AppViewModel.getInstance();
  private unsubscribe: (() => void) | null = null;

  async aboutToAppear(): Promise<void> {
    await this.viewModel.loadTasks(this.currentFilter);
    this.syncState();
    this.unsubscribe = this.viewModel.subscribe(() => this.syncState());
  }

  aboutToDisappear(): void {
    if (this.unsubscribe) this.unsubscribe();
  }

  private syncState(): void {
    this.tasks = this.viewModel.state.tasks;
    this.isLoading = this.viewModel.state.isLoading;
    if (this.viewModel.state.taskStats) {
      this.taskStats = this.viewModel.state.taskStats;
    }
  }

  build() {
    Column() {
      Row() {
        Text($r('app.string.tab_tasks'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })

      // 统计条
      Row() {
        this.FilterChip('全部', 'all')
        this.FilterChip('今日', 'today')
        this.FilterChip('本周', 'week')
        this.FilterChip('逾期', 'overdue')
        this.FilterChip('已完成', 'completed')
      }
      .width('100%')
      .padding({ left: 16, right: 16, bottom: 8 })
      .scrollable(ScrollDirection.Horizontal)

      // 新建任务输入框
      Row() {
        TextInput({ placeholder: $r('app.string.task_new'), text: this.newTaskTitle })
          .layoutWeight(1)
          .height(40)
          .borderRadius(8)
          .padding({ left: 12, right: 12 })
          .onChange((value: string) => { this.newTaskTitle = value; })

        Button('添加')
          .height(40)
          .borderRadius(8)
          .backgroundColor($r('app.color.primary'))
          .fontColor(Color.White)
          .fontSize(14)
          .margin({ left: 8 })
          .enabled(this.newTaskTitle.length > 0)
          .onClick(() => this.handleAddTask())
      }
      .width('100%')
      .padding({ left: 16, right: 16, bottom: 8 })

      // 任务列表
      if (this.isLoading) {
        LoadingProgress()
          .color($r('app.color.primary'))
          .width(32)
          .height(32)
          .margin({ top: 32 })
      } else {
        List() {
          ForEach(this.tasks, (task: Task) => {
            ListItem() {
              Row() {
                Checkbox()
                  .select(task.isCompleted === 1)
                  .onChange(() => this.viewModel.toggleTask(task.id))

                Column() {
                  Text(task.title)
                    .fontSize(15)
                    .fontColor(task.isCompleted ? $r('sys.color.ohos_id_color_text_secondary') : $r('sys.color.ohos_id_color_text_primary'))
                    .decoration({ type: task.isCompleted ? TextDecorationType.LineThrough : TextDecorationType.None })

                  if (task.dueDate) {
                    Text(task.dueDate)
                      .fontSize(11)
                      .fontColor(this.isOverdue(task.dueDate) ? $r('app.color.danger') : $r('sys.color.ohos_id_color_text_secondary'))
                      .margin({ top: 2 })
                  }
                }
                .layoutWeight(1)
                .margin({ left: 8 })
                .alignItems(HorizontalAlign.Start)

                // 优先级标识
                if (task.priority === 3) {
                  Text('高')
                    .fontSize(10)
                    .fontColor($r('app.color.danger'))
                    .padding({ left: 4, right: 4, top: 2, bottom: 2 })
                    .borderRadius(4)
                    .backgroundColor($r('app.color.danger') + '14')
                } else if (task.priority === 2) {
                  Text('中')
                    .fontSize(10)
                    .fontColor($r('app.color.warning'))
                    .padding({ left: 4, right: 4, top: 2, bottom: 2 })
                    .borderRadius(4)
                    .backgroundColor($r('app.color.warning') + '14')
                }
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 10, bottom: 10 })
            }
            .onClick(() => {
              promptAction.showDialog({
                title: '删除任务？',
                message: task.title,
                buttons: [
                  { text: '取消', color: '#666666' },
                  { text: '删除', color: '#EF4444' }
                ]
              }).then((result) => {
                if (result.index === 1) {
                  this.viewModel.deleteTask(task.id);
                }
              });
            })
          }, (task: Task) => task.id)
        }
        .width('100%')
        .layoutWeight(1)
        .divider({ strokeWidth: 0.5, color: $r('app.color.border') })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.app_background'))
  }

  @Builder
  FilterChip(label: string, filter: TaskFilter): void {
    Text(label)
      .fontSize(13)
      .fontColor(this.currentFilter === filter ? Color.White : $r('sys.color.ohos_id_color_text_primary'))
      .padding({ left: 12, right: 12, top: 6, bottom: 6 })
      .borderRadius(16)
      .backgroundColor(this.currentFilter === filter ? $r('app.color.primary') : $r('app.color.surface'))
      .margin({ right: 8 })
      .onClick(async () => {
        this.currentFilter = filter;
        await this.viewModel.loadTasks(filter);
      })
  }

  private async handleAddTask(): Promise<void> {
    if (this.newTaskTitle.trim()) {
      await this.viewModel.createTask(this.newTaskTitle.trim());
      this.newTaskTitle = '';
    }
  }

  private isOverdue(dateStr: string): boolean {
    try {
      return new Date(dateStr).getTime() < Date.now();
    } catch (e) {
      return false;
    }
  }
}
