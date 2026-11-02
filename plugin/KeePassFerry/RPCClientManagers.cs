using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using KeePass.Forms;
using KeePass.UI;
using KeePass.Util.MultipleValues;
using KeePassLib;
using KeePassLib.Collections;
using KeePassFerry.Forms;
using KeePassFerry.Models.DataExchange;
using KeePassFerry.Properties;

namespace KeePassFerry
{
    /// <summary>
    /// Base class for all RPCClient managers.
    /// </summary>
    public abstract class FerryClientManager
    {
        private string _name;
        private string _callbackMethodName;
        public string Name { get { return _name; } private set { _name = value; } }
        public string CallbackMethodName { get { return _callbackMethodName; } private set { _callbackMethodName = value; } }
        private List<FerryClientConnection> _RPCClientConnections = new List<FerryClientConnection>(1);
        private static object _lockRPCClients = new object();

        public FerryClientManager(string name, string callbackName)
        {
            Name = name;
            CallbackMethodName = callbackName;
        }

        private FerryClientManager()
        {
        }

        /// <summary>
        /// Signals all clients.
        /// </summary>
        /// <param name="signal">The signal.</param>
        public virtual void SignalAll(Signal signal)
        {
            foreach (FerryClientConnection client in _RPCClientConnections)
                client.Signal(signal, CallbackMethodName);
        }

        /// <summary>
        /// Adds an RPC client.
        /// </summary>
        /// <param name="client">The client.</param>
        public void AddRPCClientConnection(FerryClientConnection client)
        {
            lock (_lockRPCClients)
            {
                _RPCClientConnections.Add(client);
            }
        }

        /// <summary>
        /// Removes an RPC client.
        /// </summary>
        /// <param name="client">The client.</param>
        public void RemoveRPCClientConnection(FerryClientConnection client)
        {
            lock (_lockRPCClients)
            {
                _RPCClientConnections.Remove(client);
            }
        }

        /// <summary>
        /// Gets the current RPC clients. ACTUAL client list may change immediately after this array is returned.
        /// </summary>
        /// <value>The current RPC clients.</value>
        public FerryClientConnection[] CurrentRPCClientConnections
        {
            get
            {
                lock (_lockRPCClients)
                {
                    FerryClientConnection[] clients = new FerryClientConnection[_RPCClientConnections.Count];
                    _RPCClientConnections.CopyTo(clients);
                    return clients;
                }
            }
        }

        /// <summary>
        /// Terminates this server.
        /// </summary>
        public void Terminate()
        {
            lock (_lockRPCClients)
            {
                SignalAll(Signal.EXITING);
                _RPCClientConnections.Clear();
            }
        }

        public virtual void AttachToEntryDialog(KeePassFerryExt plugin, PwEntry entry, TabControl mainTabControl, PwEntryForm form, CustomListViewEx advancedListView, ProtectedStringDictionary strings, StringDictionaryEx customData)
        {
        }

        public virtual void AttachToGroupDialog(KeePassFerryExt plugin, PwGroup group, TabControl mainTabControl)
        {
        }


    }

    public class GeneralRPCClientManager : FerryClientManager
    {
        public GeneralRPCClientManager()
            : base("General", "FerryListener")
        {

        }

        public override void AttachToEntryDialog(KeePassFerryExt plugin, PwEntry entry, TabControl mainTabControl, PwEntryForm form, CustomListViewEx advancedListView, ProtectedStringDictionary strings, StringDictionaryEx customData)
        {
            UserControl entryControl;

            string mvString = MultipleValuesEx.CueString;
            string json = customData.Get(Extensions.EntryConfigKey);
            if (!string.IsNullOrEmpty(json) && mvString == json)
            {
                entryControl = new FerryMultiEntryUserControl();
            } else
            {
                entryControl = new FerryEntryUserControl(plugin, entry, advancedListView, form, strings, customData);
            }

            TabPage keeTabPage = new TabPage("KeePassFerry");
            entryControl.Dock = DockStyle.Fill;
            keeTabPage.Controls.Add(entryControl);
            if (mainTabControl.ImageList == null)
                mainTabControl.ImageList = new ImageList();
            int imageIndex = mainTabControl.ImageList.Images.Add(Resources.FerryIcon64, Color.Transparent);
            keeTabPage.ImageIndex = imageIndex;
            mainTabControl.TabPages.Add(keeTabPage);
        }

        public override void AttachToGroupDialog(KeePassFerryExt plugin, PwGroup group, TabControl mainTabControl)
        {
            FerryGroupUserControl groupControl = new FerryGroupUserControl(plugin, group);
            TabPage keeTabPage = new TabPage("KeePassFerry");
            groupControl.Dock = DockStyle.Fill;
            keeTabPage.Controls.Add(groupControl);
            if (mainTabControl.ImageList == null)
                mainTabControl.ImageList = new ImageList();
            int imageIndex = mainTabControl.ImageList.Images.Add(Resources.FerryIcon64, Color.Transparent);
            keeTabPage.ImageIndex = imageIndex;
            mainTabControl.TabPages.Add(keeTabPage);
        }

    }

}